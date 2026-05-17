import { loadPitchDetectionConfig, subscribePitchDetectionConfig } from "@/config/pitchDetection.config";
import type { PitchDetectionConfig } from "@/config/pitchDetection.config";

import { BasicPitchWorkerClient } from "./basic-pitch-worker-client";
import type { DetectionMetricsSnapshot } from "./pitch-detection-metrics";
import { PitchDetectionMetricsStore } from "./pitch-detection-metrics";
import { PolyphonicStabilizer } from "./polyphonic-stabilizer";
import { rmsFloat32, resampleMonoTo22050 } from "./pitch-resample";
import type { AudioCaptureWorklet } from "@/lib/audio/audio-capture-worklet";

/** Rolling Basic Pitch inference + stabilization (runs on client only). */
export class BasicPitchDetector {
  private capture: AudioCaptureWorklet | null = null;

  private worker: BasicPitchWorkerClient | null = null;

  private stabilizer: PolyphonicStabilizer;

  private metricsStore: PitchDetectionMetricsStore;

  private cfgUnsub: (() => void) | null = null;

  private hopTimer: ReturnType<typeof setInterval> | null = null;

  private metricsTimer: ReturnType<typeof setInterval> | null = null;

  private inflight = 0;

  private windowSeq = 0;

  private lastExpectedHopWall = 0;

  started = false;

  private cfg: PitchDetectionConfig;

  onMetrics: ((snap: DetectionMetricsSnapshot) => void) | null = null;

  lastInferNotesCount = 0;

  constructor(private readonly audioCtx: AudioContext) {
    this.cfg = loadPitchDetectionConfig();
    this.stabilizer = new PolyphonicStabilizer(this.cfg);
    this.metricsStore = new PitchDetectionMetricsStore(this.cfg);
  }

  attachCapture(capture: AudioCaptureWorklet | null): void {
    this.capture = capture;
  }

  /** Model + WASM fetched from origin `/basic-pitch-model` and `/tfjs-wasm`. */
  async init(): Promise<void> {
    if (typeof window === "undefined") return;
    const origin = window.location.origin;
    const w = new BasicPitchWorkerClient({
      modelUrl: `${origin}/basic-pitch-model/model.json`,
      wasmBaseUrl: `${origin}/tfjs-wasm`,
      preferBackend: this.cfg.tfjsPreferBackend,
    });
    await w.ensureWorker();
    this.worker = w;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stabilizer.reset();
    this.metricsStore.reset();

    this.cfgUnsub?.();
    this.cfgUnsub = subscribePitchDetectionConfig(() => {
      this.cfg = loadPitchDetectionConfig();
      this.stabilizer.updateCfg(this.cfg);
      this.metricsStore.updateCfg(this.cfg);
      this.rescheduleTimers();
    });

    this.rescheduleTimers();
  }

  private rescheduleTimers(): void {
    if (this.hopTimer) {
      clearInterval(this.hopTimer);
      this.hopTimer = null;
    }
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    if (!this.started) return;

    const hopMs = Math.max(50, this.cfg.hopSec * 1000);
    this.lastExpectedHopWall =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    this.hopTimer = setInterval(() => void this.tick(), hopMs);

    if (this.cfg.metricsEnabled) {
      const mi = Math.max(100, this.cfg.metricsEmitIntervalMs);
      this.metricsTimer = setInterval(() => this.emitMetrics(), mi);
    }
  }

  stop(): void {
    this.started = false;
    if (this.hopTimer) clearInterval(this.hopTimer);
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    this.hopTimer = null;
    this.metricsTimer = null;
    this.cfgUnsub?.();
    this.cfgUnsub = null;
    this.stabilizer.reset();
  }

  dispose(): void {
    this.stop();
    this.worker?.dispose();
    this.worker = null;
  }

  midisEvidenceAt(anchorCtxMs: number): Set<number> {
    return this.stabilizer.midisEvidenceAt(anchorCtxMs);
  }

  private emitMetrics(): void {
    if (!this.cfg.metricsEnabled) return;
    const snap = this.metricsStore.snapshot(this.inflight, this.stabilizer.snapshot().length);
    this.onMetrics?.(snap);
  }

  private async tick(): Promise<void> {
    if (!this.started || !this.capture || !this.worker) return;

    const nowWall = typeof performance !== "undefined" ? performance.now() : Date.now();
    let lagMs = 0;
    if (this.lastExpectedHopWall > 0) lagMs = Math.max(0, nowWall - this.lastExpectedHopWall);
    this.lastExpectedHopWall =
      (this.lastExpectedHopWall > 0 ? this.lastExpectedHopWall : nowWall) +
      this.cfg.hopSec * 1000;

    this.cfg = loadPitchDetectionConfig();
    const sr = this.audioCtx.sampleRate;
    const windowSamples = Math.max(4096, Math.floor(this.cfg.windowSec * sr));

    let pcmTail;
    try {
      pcmTail = await this.capture.requestPcmTail(windowSamples);
    } catch {
      return;
    }

    const rmsPre = rmsFloat32(pcmTail.pcm);
    if (this.cfg.silenceSkipWindows && rmsPre < this.cfg.silenceThresholdRms) {
      this.metricsStore.pushWindowMetrics({
        inferMs: 0,
        decodeMs: 0,
        resampleMs: 0,
        schedulerLagMs: lagMs,
        rms: rmsPre,
      });
      return;
    }

    if (this.inflight >= this.cfg.maxBacklog) {
      this.metricsStore.recordDrop();
      if (this.cfg.dropPolicy === "skip_tick") return;
      return;
    }

    const windowEndCtxSec = pcmTail.audioCtxTime;
    const tRes0 =
      typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    let pcm22050;
    try {
      pcm22050 =
        pcmTail.sampleRate === this.cfg.modelSampleRateHz
          ? pcmTail.pcm.slice()
          : await resampleMonoTo22050(pcmTail.pcm, pcmTail.sampleRate);
    } catch {
      return;
    }
    const tRes1 =
      typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

    const wid = ++this.windowSeq;
    this.inflight++;
    const decoding = {
      onsetThresh: this.cfg.onsetThresh,
      frameThresh: this.cfg.frameThresh,
      minNoteLenFrames: this.cfg.minNoteLenFrames,
      tailEmitSec: this.cfg.tailEmitSec,
      windowSec: this.cfg.windowSec,
      emitTailOnly: this.cfg.emitTailOnly,
      includeOverlaps: this.cfg.includeOverlaps,
    };

    try {
      const res = await this.worker.infer({
        windowId: wid,
        pcm: pcm22050,
        decoding,
        windowEndCtxSec,
      });
      this.stabilizer.ingest(wid, res.notes);
      this.lastInferNotesCount = res.notes.length;
      this.metricsStore.pushWindowMetrics({
        inferMs: res.inferMs,
        decodeMs: res.decodeMs,
        resampleMs: tRes1 - tRes0,
        schedulerLagMs: lagMs,
        rms: rmsPre,
      });
      for (let ei = 0; ei < res.notes.length; ei++) this.metricsStore.noteEmitted();
    } catch {
      /* inference errors are non-fatal for gameplay */
    } finally {
      this.inflight--;
    }
  }
}
