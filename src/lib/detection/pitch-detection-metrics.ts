import type { PitchDetectionConfig } from "@/config/pitchDetection.config";

export type DetectionMetricsSnapshot = {
  tsMs: number;
  avgInferMs: number;
  p95InferMs: number;
  avgDecodeMs: number;
  avgResampleMs: number;
  avgSchedulerLagMs: number;
  inflight: number;
  droppedWindowsTotal: number;
  windowsPerSec: number;
  rmsAvg: number;
  activeNotesNow: number;
  notesEmittedPerSec: number;
  avgNoteOnLatencyMs: number;
  p95NoteOnLatencyMs: number;
};

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1)));
  return s[idx] ?? 0;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export class PitchDetectionMetricsStore {
  private inferMs: number[] = [];

  private decodeMs: number[] = [];

  private resampleMs: number[] = [];

  private lagMs: number[] = [];

  private rms: number[] = [];

  private noteLatencies: number[] = [];

  droppedWindowsTotal = 0;

  tickCount = 0;

  private lastTickWall = 0;

  private tickWindows = 0;

  notesEmittedRecent = 0;

  constructor(private cfg: PitchDetectionConfig) {}

  pushWindowMetrics(p: {
    inferMs: number;
    decodeMs: number;
    resampleMs: number;
    schedulerLagMs: number;
    rms: number;
  }): void {
    const cap = this.cfg.metricsRingSize;
    const pushRing = <T extends number>(arr: T[], v: T) => {
      arr.push(v);
      if (arr.length > cap) arr.splice(0, arr.length - cap);
    };

    pushRing(this.inferMs, p.inferMs);
    pushRing(this.decodeMs, p.decodeMs);
    pushRing(this.resampleMs, p.resampleMs);
    pushRing(this.lagMs, p.schedulerLagMs);
    pushRing(this.rms, p.rms);
    this.tickWindows++;
  }

  pushLatencyMs(ms: number): void {
    this.noteLatencies.push(ms);
    if (this.noteLatencies.length > this.cfg.metricsRingSize)
      this.noteLatencies.splice(0, this.noteLatencies.length - this.cfg.metricsRingSize);
  }

  recordDrop(): void {
    this.droppedWindowsTotal++;
  }

  noteEmitted(): void {
    this.notesEmittedRecent++;
  }

  updateCfg(cfg: PitchDetectionConfig) {
    this.cfg = cfg;
  }

  reset(): void {
    this.inferMs = [];
    this.decodeMs = [];
    this.resampleMs = [];
    this.lagMs = [];
    this.rms = [];
    this.noteLatencies = [];
    this.droppedWindowsTotal = 0;
    this.tickCount = 0;
    this.lastTickWall = 0;
    this.tickWindows = 0;
    this.notesEmittedRecent = 0;
  }

  /** Called from metrics interval tick (main thread). */
  snapshot(inflight: number, activeNotesNow: number): DetectionMetricsSnapshot {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (this.lastTickWall === 0) this.lastTickWall = now;
    const dt = (now - this.lastTickWall) / 1000;
    this.lastTickWall = now;
    const wps = dt > 0 ? this.tickWindows / dt : 0;
    const notesPerSec = dt > 0 ? this.notesEmittedRecent / dt : 0;
    this.tickWindows = 0;
    this.notesEmittedRecent = 0;
    this.tickCount++;

    return {
      tsMs: now,
      avgInferMs: avg(this.inferMs),
      p95InferMs: p95(this.inferMs),
      avgDecodeMs: avg(this.decodeMs),
      avgResampleMs: avg(this.resampleMs),
      avgSchedulerLagMs: avg(this.lagMs),
      inflight,
      droppedWindowsTotal: this.droppedWindowsTotal,
      windowsPerSec: wps,
      rmsAvg: avg(this.rms),
      activeNotesNow,
      notesEmittedPerSec: notesPerSec,
      avgNoteOnLatencyMs: avg(this.noteLatencies),
      p95NoteOnLatencyMs: p95(this.noteLatencies),
    };
  }
}
