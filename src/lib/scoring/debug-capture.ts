import type { Verdict } from "./engine";
import type { DetectionMetricsSnapshot } from "@/lib/detection/pitch-detection-metrics";

import type { StringProfile } from "../calibration/string-profile";

/** Version for analysis scripts parsing MinIO blobs. */
export const DEBUG_REPORT_VERSION = 3;

export type DebugDecisionOutcome =
  | "accepted"
  | "wrong-pitch"
  | "timing-miss"
  | "unmatched-onset"
  | "missed-no-onset";

/** Why this blob was flushed (helps analysis compare mid-track pauses vs full runs). */
export type DebugReportFlushReason = "manual" | "run-complete" | "pause" | "exit";

export type ExpectedEventSnapshot = {
  id: string;
  t0: number;
  /** End of chart note; omitted in older captures — treated as `t0` for timing grace. */
  t1?: number;
  notes: Array<{ string: number; midi: number; dead?: boolean; palmMute?: boolean }>;
  kind: string;
  /** e.g. GP "mute" for palm-muted passage */
  tech?: string[];
};

export type CandidateSnapshot = {
  eventId: string;
  deltaSec: number;
};

export type BpTraceSnapshot = {
  kind: "bp";
  evidenceMidis: number[];
  dominantMidi: number | null;
  /** Active stabilizer voices overlapping onset but excluded by maxSimulNotes / confidence gate */
  stabilizerDroppedMidis?: number[];
};

export type MonoTraceSnapshot = {
  kind: "mono";
  yinHz: number | null;
  cmndfMin: number | null;
  detectedMidi: number | null;
  detectedHz: number | null;
  centsPerNote: Array<{ string: number; midi: number; cents: number | null }>;
};

export type PolyTraceSnapshot = {
  kind: "poly";
  detectedMidi: number | null;
  detectedHz: number | null;
  normEnergy: number;
  supportThreshold: number;
  perNote: Array<{
    string: number;
    midi: number;
    support: number;
    pitchOk: boolean;
  }>;
};

export type DebugDecision = {
  /** Monotonic capture index inside this session */
  index: number;
  songTimeSec: number;
  audioContextTime: number | null;
  outcome: DebugDecisionOutcome;

  latencyMsSetting: number;
  verdict: Verdict | null;
  timingErrorMs: number | null;

  expectedEvent: ExpectedEventSnapshot | null;
  isPoly: boolean | null;

  rms: number;
  flux: number | null;
  fluxThreshold: number | null;

  candidates: CandidateSnapshot[];

  trace: MonoTraceSnapshot | PolyTraceSnapshot | BpTraceSnapshot | null;

  /** Matches RECOGNITION_FFT_SIZE / 2 + 1 spectral magnitudes after strum aggregation */
  spectrum: number[];
  waveSnippet: number[];

  detectedMidiGlob: number | null;

  pitchTelemetry?: DetectionMetricsSnapshot | null;

  /** Wall-clock timing inside onset handler when debug capture is on (v2+) */
  handlerProbeMs?: {
    evidenceMs: number;
    scoreMs: number;
  };
};

export type DebugReportMeta = {
  songId: string;
  trackId: string;
  runStartedAt: string;
  latencyMs: number;
  chartTuning: string[];
  capoFret: number | null;
  capturedAtIso: string;
  /** Omitted on older blobs; treat as `"manual"` in analysis when absent */
  reason?: DebugReportFlushReason;
  /** AudioContext / worklet sample rate for replaying spectra + YIN (omitted on older blobs) */
  audioSampleRate?: number;
  /** Sibling object key for optional session recording (.webm / .ogg) */
  audioRecordingKey?: string;
  audioRecordingMime?: string;
  /** Best-effort duration from recorder or audio element */
  audioRecordingDurationSec?: number;
  /** String calibration blob used during this session (DEBUG_REPORT_VERSION 3+) */
  stringProfile?: StringProfile;
};

export type DebugReport = {
  version: 1 | 2 | typeof DEBUG_REPORT_VERSION;
  meta: DebugReportMeta;
  decisions: DebugDecision[];
};

const DEFAULT_CAP = 500;

function float32ToNumberArray(buf: Float32Array): number[] {
  const n = buf.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = buf[i] ?? 0;
  return out;
}

export class DebugCapture {
  private decisions: DebugDecision[] = [];

  private nextIndex = 0;

  constructor(private readonly cap = DEFAULT_CAP) {}

  /** Number of decisions currently buffered */
  get length(): number {
    return this.decisions.length;
  }

  push(d: Omit<DebugDecision, "index">): void {
    const row: DebugDecision = { ...d, index: this.nextIndex++ };
    this.decisions.push(row);
    if (this.decisions.length > this.cap) {
      this.decisions.splice(0, this.decisions.length - this.cap);
    }
  }

  clear(): void {
    this.decisions.length = 0;
    this.nextIndex = 0;
  }

  snapshot(meta: DebugReportMeta): DebugReport {
    return {
      version: DEBUG_REPORT_VERSION,
      meta,
      decisions: this.decisions.map((d) => ({ ...d })),
    };
  }

  serializeReport(report: DebugReport): string {
    return JSON.stringify(report);
  }

  /** Copy FFT buffers before reuse (worklet may transfer ArrayBuffers). */
  static copySpectrum(spectrum: Float32Array): number[] {
    return float32ToNumberArray(spectrum);
  }

  static copyWaveSnippet(snippet: Float32Array): number[] {
    return float32ToNumberArray(snippet);
  }
}
