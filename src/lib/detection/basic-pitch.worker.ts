/// <reference lib="webworker" />

import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-wasm";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";

import type {
  BpInferRequest,
  BpWorkerInbound,
  BpWorkerOutbound,
  DetectedNote,
  PitchDetectionDecodingParams,
} from "./types";

let basicPitchReady: BasicPitch | null = null;

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function filterTailNotes(
  notes: Array<{ startMs: number; endMs: number; pitchMidi: number; amplitude: number }>,
  windowLeftMs: number,
  windowDurationMs: number,
  p: PitchDetectionDecodingParams,
): DetectedNote[] {
  const windowEndMs = windowLeftMs + windowDurationMs;
  const tailStartMs = windowLeftMs + Math.max(0, windowDurationMs - p.tailEmitSec * 1000);
  const out: DetectedNote[] = [];

  for (const n of notes) {
    const overlapsTail = n.endMs > tailStartMs && n.startMs < windowEndMs;
    const startsInTail = n.startMs >= tailStartMs && n.startMs <= windowEndMs;
    if (!p.emitTailOnly) {
      const accept = overlapsTail || n.startMs <= windowEndMs;
      if (accept) {
        out.push({
          pitchMidi: n.pitchMidi,
          startMs: n.startMs,
          endMs: n.endMs,
          amplitude: n.amplitude,
          confidence: Math.min(1, n.amplitude),
          source: "basicpitch",
          isContinuation: n.startMs < tailStartMs && overlapsTail ? true : undefined,
        });
      }
      continue;
    }
    if (startsInTail) {
      out.push({
        pitchMidi: n.pitchMidi,
        startMs: n.startMs,
        endMs: n.endMs,
        amplitude: n.amplitude,
        confidence: Math.min(1, n.amplitude),
        source: "basicpitch",
      });
    } else if (p.includeOverlaps && overlapsTail) {
      out.push({
        pitchMidi: n.pitchMidi,
        startMs: n.startMs,
        endMs: n.endMs,
        amplitude: n.amplitude,
        confidence: Math.min(1, n.amplitude),
        source: "basicpitch",
        isContinuation: true,
      });
    }
  }

  return out;
}

async function ensureModel(message: Extract<BpWorkerInbound, { type: "init" }>) {
  const { wasmBaseUrl, preferBackend } = message;
  const base = wasmBaseUrl.endsWith("/") ? wasmBaseUrl : `${wasmBaseUrl}/`;
  setWasmPaths(base);

  await tf.ready();
  if (preferBackend === "wasm") {
    await tf.setBackend("wasm").catch(async () => {
      await tf.setBackend("cpu");
    });
  } else {
    await tf.setBackend("webgl").catch(async () => {
      await tf.setBackend("wasm").catch(async () => {
        await tf.setBackend("cpu");
      });
    });
  }

  basicPitchReady = new BasicPitch(message.modelUrl);
  await basicPitchReady.model;
}

async function runInferAsync(payload: Omit<BpInferRequest, "type">): Promise<BpInferResponseComputed> {
  const bp = basicPitchReady;
  if (!bp) {
    throw new Error("Basic Pitch not initialized");
  }

  const t0 = nowMs();

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  const decoding = payload.decoding;
  await bp.evaluateModel(
    payload.pcm as Float32Array,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    () => {},
  );

  const t1 = nowMs();
  const inferMs = t1 - t0;

  const dDecode0 = nowMs();

  const midiNotes = noteFramesToTime(
    addPitchBendsToNoteEvents(contours as never, outputToNotesPoly(
      frames,
      onsets,
      decoding.onsetThresh,
      decoding.frameThresh,
      decoding.minNoteLenFrames,
      true,
      null,
      null,
      true,
    ) as never),
  );

  const windowDurationMs = (payload.pcm.length / 22050) * 1000;
  const windowEndMs = payload.windowEndCtxSec * 1000;
  const windowLeftMs = windowEndMs - windowDurationMs;

  const decoded = midiNotes.map((n) => ({
    pitchMidi: n.pitchMidi,
    amplitude: typeof n.amplitude === "number" ? n.amplitude : 0,
    startMs: windowLeftMs + n.startTimeSeconds * 1000,
    endMs: windowLeftMs + (n.startTimeSeconds + n.durationSeconds) * 1000,
  }));

  const notes = filterTailNotes(decoded, windowLeftMs, windowDurationMs, decoding);

  const dDecode1 = nowMs();

  return {
    type: "inferResult",
    windowId: payload.windowId,
    inferMs,
    decodeMs: dDecode1 - dDecode0,
    notes,
  };
}

type BpInferResponseComputed = Extract<BpWorkerOutbound, { type: "inferResult" }>;

self.onmessage = async (ev: MessageEvent<BpWorkerInbound>) => {
  const d = ev.data;
  try {
    if (d?.type === "init") {
      await ensureModel(d);
      self.postMessage({ type: "ready" } satisfies BpWorkerOutbound);
      return;
    }
    if (d?.type === "infer") {
      const pcm = Float32Array.from(d.pcm);
      const msg = await runInferAsync({
        windowId: d.windowId,
        pcm,
        decoding: d.decoding,
        windowEndCtxSec: d.windowEndCtxSec,
      });
      self.postMessage(msg satisfies BpWorkerOutbound);
      return;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    self.postMessage({ type: "error", message } satisfies BpWorkerOutbound);
  }
};
