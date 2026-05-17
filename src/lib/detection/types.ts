export type DetectedNote = {
  pitchMidi: number;
  startMs: number;
  endMs: number;
  amplitude: number;
  confidence?: number;
  source: "basicpitch";
  isContinuation?: boolean;
};

/** Worker-bound inference request payload */
export type BpInferRequest = {
  type: "infer";
  windowId: number;
  /** Mono PCM at 22050 Hz */
  pcm: Float32Array;
  decoding: PitchDetectionDecodingParams;
  /** AudioContext-relative seconds for last sample of `pcm` */
  windowEndCtxSec: number;
};

export type PitchDetectionDecodingParams = {
  onsetThresh: number;
  frameThresh: number;
  minNoteLenFrames: number;
  tailEmitSec: number;
  windowSec: number;
  emitTailOnly: boolean;
  includeOverlaps: boolean;
};

export type BpInferResponse = {
  type: "inferResult";
  windowId: number;
  inferMs: number;
  decodeMs: number;
  notes: DetectedNote[];
};

export type BpWorkerInbound =
  | { type: "init"; modelUrl: string; wasmBaseUrl: string; preferBackend: "wasm" | "webgl" }
  | BpInferRequest;

export type BpWorkerOutbound =
  | { type: "ready" }
  | { type: "error"; message: string }
  | BpInferResponse;

export type StabilizerNoteOn = {
  id: number;
  pitchMidi: number;
  timeMs: number;
  velocity: number;
};

export type StabilizerNoteOff = {
  id: number;
  timeMs: number;
};
