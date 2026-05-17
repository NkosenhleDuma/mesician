import { z } from "zod";

/**
 * Global tunables for Basic Pitch rolling detection (see BASIC_PITCH_IMPLEMENTATION.md).
 * Runtime updates via `setPitchDetectionConfig`; applied on next scheduler tick.
 */

export const PitchDetectionConfigSchema = z.object({
  windowSec: z.number().positive().max(5),
  hopSec: z.number().positive().max(2),
  /** Emit only notes beginning in final `tailEmitSec` of each window when `emitTailOnly` */
  tailEmitSec: z.number().positive().max(2),
  /** Ring buffer retention (≥ windowSec + small margin) */
  bufferSec: z.number().positive().max(8),
  maxBacklog: z.number().int().min(1).max(10),
  dropPolicy: z.enum(["drop_oldest", "skip_tick"]),
  modelSampleRateHz: z.literal(22050),
  resampler: z.enum(["offlineAudioContext"]),
  onsetThresh: z.number().min(0).max(1),
  frameThresh: z.number().min(0).max(1),
  /** Minimum note duration in decoder (frames dimension for outputToNotesPoly) */
  minNoteLenFrames: z.number().int().min(1).max(200),
  includeOverlaps: z.boolean(),
  emitTailOnly: z.boolean(),
  polyphonicEnabled: z.boolean(),
  maxSimulNotes: z.number().int().min(1).max(12),
  polyphonyConfidenceGate: z.number().min(0).max(1),
  polyphonyStabilityWindows: z.number().int().min(0).max(10),
  mergeStartToleranceMs: z.number().min(0).max(300),
  gapCloseToleranceMs: z.number().min(0).max(300),
  missesToClose: z.number().int().min(1).max(10),
  strongAmplitudeThreshold: z.number().min(0).max(1),
  allowLegatoNoteOn: z.boolean(),
  legatoStabilityWindows: z.number().int().min(0).max(10),
  silenceThresholdRms: z.number().min(0).max(0.5),
  silenceSkipWindows: z.boolean(),
  metricsEnabled: z.boolean(),
  metricsRingSize: z.number().int().min(10).max(5000),
  metricsEmitIntervalMs: z.number().int().min(50).max(5000),

  /** When true (default): flux onset timestamps fine timing; BP supplies pitch asynchronously */
  useFluxTimingGate: z.boolean(),
  /** Half-width ± around onset (ms) to match BP-evidenced MIDI candidates */
  bpPitchEvidenceWindowMs: z.number().min(10).max(500),
  /** When BP yields nothing stale, optionally fall back (uses sync spectrum/YIN paths) */
  fallbackHarmonicVerifier: z.boolean(),

  activeNotesEmitIntervalMs: z.number().int().min(20).max(1000),

  tfjsPreferBackend: z.enum(["wasm", "webgl"]),
});

export type PitchDetectionConfig = z.infer<typeof PitchDetectionConfigSchema>;

export const defaultPitchDetectionConfig: PitchDetectionConfig = {
  windowSec: 0.8,
  hopSec: 0.2,
  tailEmitSec: 0.2,
  bufferSec: 2.0,
  maxBacklog: 2,
  dropPolicy: "drop_oldest",
  modelSampleRateHz: 22050,
  resampler: "offlineAudioContext",
  onsetThresh: 0.25,
  frameThresh: 0.25,
  minNoteLenFrames: Math.max(5, Math.round(0.1 * (22050 / 256))),
  includeOverlaps: true,
  emitTailOnly: true,
  polyphonicEnabled: true,
  maxSimulNotes: 4,
  polyphonyConfidenceGate: 0.22,
  polyphonyStabilityWindows: 2,
  mergeStartToleranceMs: 80,
  gapCloseToleranceMs: 60,
  missesToClose: 2,
  strongAmplitudeThreshold: 0.35,
  allowLegatoNoteOn: true,
  legatoStabilityWindows: 3,
  silenceThresholdRms: 0.005,
  silenceSkipWindows: true,
  metricsEnabled: true,
  metricsRingSize: 600,
  metricsEmitIntervalMs: 350,
  useFluxTimingGate: true,
  bpPitchEvidenceWindowMs: 120,
  fallbackHarmonicVerifier: true,
  activeNotesEmitIntervalMs: 100,
  tfjsPreferBackend: "wasm",
};

const ENV_PREFIX = "NEXT_PUBLIC_PITCHDET_";

type ConfigListeners = Map<number, () => void>;
let nextListenerId = 1;
let configListeners: ConfigListeners | null = null;

function parseEnvOverrides(): Partial<PitchDetectionConfig> {
  if (typeof process === "undefined" || !process.env) return {};

  const e = process.env;
  const o: Partial<PitchDetectionConfig> = {};

  const num = (key: keyof PitchDetectionConfig, envKey: string) => {
    const v = e[`${ENV_PREFIX}${envKey}`];
    if (v === undefined || v === "") return;
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    Object.assign(o, { [key]: n });
  };
  const bol = (key: keyof PitchDetectionConfig, envKey: string) => {
    const v = e[`${ENV_PREFIX}${envKey}`];
    if (v === undefined || v === "") return;
    Object.assign(o, { [key]: v === "true" || v === "1" });
  };

  num("windowSec", "WINDOW_SEC");
  num("hopSec", "HOP_SEC");
  num("tailEmitSec", "TAIL_EMIT_SEC");
  num("bufferSec", "BUFFER_SEC");
  num("maxBacklog", "MAX_BACKLOG");
  num("silenceThresholdRms", "SILENCE_RMS");

  bol("fallbackHarmonicVerifier", "FALLBACK_HARMONIC");
  bol("metricsEnabled", "METRICS");
  bol("emitTailOnly", "EMIT_TAIL_ONLY");

  return o;
}

let runtimeStore: PitchDetectionConfig = PitchDetectionConfigSchema.parse({
  ...defaultPitchDetectionConfig,
  ...parseEnvOverrides(),
});

/** Validated singleton; merges env overrides on first load only (Next build-time embed). */
export function loadPitchDetectionConfig(): PitchDetectionConfig {
  return runtimeStore;
}

export function validatePitchDetectionConfig(p: unknown): PitchDetectionConfig {
  return PitchDetectionConfigSchema.parse(p);
}

export function setPitchDetectionConfig(partial: Partial<PitchDetectionConfig>): PitchDetectionConfig {
  runtimeStore = PitchDetectionConfigSchema.parse({ ...runtimeStore, ...partial });
  configListeners?.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore */
    }
  });
  return runtimeStore;
}

export function subscribePitchDetectionConfig(listener: () => void): () => void {
  if (!configListeners) configListeners = new Map();
  const id = nextListenerId++;
  configListeners.set(id, listener);
  return () => {
    configListeners?.delete(id);
  };
}
