import type { PitchDetectionConfig } from "@/config/pitchDetection.config";

import type { DetectedNote } from "./types";

export type StableActivePitch = {
  pitchMidi: number;
  mergedStartMs: number;
  mergedEndMs: number;
  maxAmplitude: number;
  confidenceEma: number;
  lastWindowId: number;
};

type Internal = StableActivePitch & {
  unseenStreak: number;
};

/**
 * Lightweight polyphonic ledger across overlapping Basic Pitch tails.
 */
export class PolyphonicStabilizer {
  private active = new Map<number, Internal>();

  constructor(private cfg: PitchDetectionConfig) {}

  updateCfg(cfg: PitchDetectionConfig) {
    this.cfg = cfg;
  }

  ingest(windowId: number, notes: DetectedNote[]): void {
    const seenKeys = new Set<number>();

    for (const n of notes) {
      const midi = Math.round(n.pitchMidi);
      seenKeys.add(midi);
      const existing = this.active.get(midi);
      const conf = typeof n.confidence === "number" ? n.confidence : Math.min(1, n.amplitude);

      if (!existing) {
        this.active.set(midi, {
          pitchMidi: midi,
          mergedStartMs: n.startMs,
          mergedEndMs: n.endMs,
          maxAmplitude: n.amplitude,
          confidenceEma: conf,
          lastWindowId: windowId,
          unseenStreak: 0,
        });
        continue;
      }

      const startClose =
        Math.abs(n.startMs - existing.mergedStartMs) <= this.cfg.mergeStartToleranceMs ||
        (n.startMs <= existing.mergedEndMs + this.cfg.gapCloseToleranceMs &&
          n.endMs >= existing.mergedStartMs - this.cfg.gapCloseToleranceMs);

      if (startClose || existing.lastWindowId === windowId - 1) {
        existing.mergedStartMs = Math.min(existing.mergedStartMs, n.startMs);
        existing.mergedEndMs = Math.max(existing.mergedEndMs, n.endMs);
        existing.maxAmplitude = Math.max(existing.maxAmplitude, n.amplitude);
        existing.confidenceEma = existing.confidenceEma * 0.7 + conf * 0.3;
        existing.lastWindowId = windowId;
        existing.unseenStreak = 0;
      } else {
        this.active.delete(midi);
        this.active.set(midi, {
          pitchMidi: midi,
          mergedStartMs: n.startMs,
          mergedEndMs: n.endMs,
          maxAmplitude: n.amplitude,
          confidenceEma: conf,
          lastWindowId: windowId,
          unseenStreak: 0,
        });
      }
    }

    for (const [k, v] of this.active.entries()) {
      if (seenKeys.has(k)) continue;
      v.unseenStreak++;
      if (v.unseenStreak >= this.cfg.missesToClose) this.active.delete(k);
    }
  }

  snapshot(): StableActivePitch[] {
    const ranked = [...this.active.values()].sort((a, b) => {
      const c = b.confidenceEma - a.confidenceEma;
      if (Math.abs(c) > 1e-6) return c;
      return b.maxAmplitude - a.maxAmplitude;
    });

    const out: StableActivePitch[] = [];
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i]!;
      if (out.length >= this.cfg.maxSimulNotes) break;
      if (i === 0) {
        const { unseenStreak: _us, ...rest } = r;
        void _us;
        out.push(rest);
        continue;
      }
      if (r.confidenceEma >= this.cfg.polyphonyConfidenceGate) {
        const { unseenStreak: _us, ...rest } = r;
        void _us;
        out.push(rest);
      }
    }
    return out;
  }

  /** MIDI values considered sounding around `anchorCtxMs` (AudioContext-aligned ms). */
  midisEvidenceAt(anchorCtxMs: number): Set<number> {
    const hw = this.cfg.bpPitchEvidenceWindowMs;
    const s = new Set<number>();
    for (const row of this.snapshot()) {
      if (anchorCtxMs + hw >= row.mergedStartMs && anchorCtxMs - hw <= row.mergedEndMs) {
        s.add(row.pitchMidi);
      }
    }
    return s;
  }

  /**
   * All ledger MIDIs overlapping the anchor (ignores maxSimulNotes / confidence gate).
   * Compare with `midisEvidenceAt` for stabilizer "dropped" debugging.
   */
  midisRawActiveAt(anchorCtxMs: number): Set<number> {
    const hw = this.cfg.bpPitchEvidenceWindowMs;
    const s = new Set<number>();
    for (const row of this.active.values()) {
      if (anchorCtxMs + hw >= row.mergedStartMs && anchorCtxMs - hw <= row.mergedEndMs) {
        s.add(row.pitchMidi);
      }
    }
    return s;
  }

  reset(): void {
    this.active.clear();
  }
}
