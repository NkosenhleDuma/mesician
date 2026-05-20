export type Verdict = "perfect" | "slightEarly" | "slightLate" | "early" | "late" | "miss";

export const VERDICT_WINDOWS_MS = {
  perfect: 35,
  slight: 80,
  off: 150,
} as const;

/**
 * Extra tolerance on the **late** side of `t0` scales with chart note length `[t0, t1]`, capped.
 * Early side stays fixed at `VERDICT_WINDOWS_MS.off`. See `lateGraceMsFromDuration`.
 */
export const LATE_TIMING_GRACE_MS_PER_NOTE_S = 80;
/** Upper bound so very long notes do not open unbounded late strum windows. */
export const LATE_TIMING_GRACE_MS_MAX = 90;

/** Extra ms allowed after `t0` before a hit is timing-miss, derived from note duration. */
export function lateGraceMsFromDuration(noteDurationSec: number): number {
  const d = Number.isFinite(noteDurationSec) ? Math.max(0, noteDurationSec) : 0;
  const raw = Math.floor(LATE_TIMING_GRACE_MS_PER_NOTE_S * d);
  return Math.min(LATE_TIMING_GRACE_MS_MAX, raw);
}

export const VERDICT_POINTS: Record<Verdict, number> = {
  perfect: 100,
  slightEarly: 60,
  slightLate: 60,
  early: 30,
  late: 30,
  miss: 0,
};

export const MULTIPLIER_MIN = 1;
export const MULTIPLIER_MAX = 5;

export type NoteHit = {
  string: number;
  expectedMidi: number;
  pitchOk: boolean;
  verdict: Verdict;
  timingErrorMs: number;
};

export type ScoreEventResult = {
  eventId: string;
  detectedMidi: number | null;
  detectedHz: number | null;
  notes: NoteHit[];
};

export function verdictKey(eventId: string, gpString: number): string {
  return `${eventId}:${gpString}`;
}

export type VerdictWindowsMs = typeof VERDICT_WINDOWS_MS;

/** User overrides for replay / tuning — values are plain numbers, not literal-typed. */
export type VerdictWindowsOverride = {
  perfect?: number;
  slight?: number;
  off?: number;
};

export type VerdictWindowsResolved = {
  perfect: number;
  slight: number;
  off: number;
};

export function resolveVerdictWindows(override?: VerdictWindowsOverride): VerdictWindowsResolved {
  return {
    perfect: override?.perfect ?? VERDICT_WINDOWS_MS.perfect,
    slight: override?.slight ?? VERDICT_WINDOWS_MS.slight,
    off: override?.off ?? VERDICT_WINDOWS_MS.off,
  };
}

export function classifyTiming(timingErrorMs: number, windows?: VerdictWindowsOverride): Verdict {
  const w = resolveVerdictWindows(windows);
  const absErrorMs = Math.abs(timingErrorMs);
  if (absErrorMs <= w.perfect) return "perfect";
  if (absErrorMs <= w.slight) {
    return timingErrorMs < 0 ? "slightEarly" : "slightLate";
  }
  if (absErrorMs <= w.off) return timingErrorMs < 0 ? "early" : "late";
  return "miss";
}

/**
 * Like `classifyTiming`, but note length only widens the **outer late** boundary (still `t0`-centered).
 * Early / on-time / slightly-early bands match `classifyTiming`; late hits get `off + lateGraceMsFromDuration(noteDurationSec)` before `miss`.
 */
export function classifyTimingDirected(
  timingErrorMs: number,
  noteDurationSec: number,
  windows?: VerdictWindowsOverride,
): Verdict {
  if (timingErrorMs < 0) {
    return classifyTiming(timingErrorMs, windows);
  }
  const w = resolveVerdictWindows(windows);
  const grace = lateGraceMsFromDuration(noteDurationSec);
  const lateOffBound = w.off + grace;
  const absErrorMs = timingErrorMs;
  if (absErrorMs <= w.perfect) return "perfect";
  if (absErrorMs <= w.slight) return "slightLate";
  if (absErrorMs <= lateOffBound) return "late";
  return "miss";
}

export type ScoreState = {
  total: number;
  multiplier: number;
  combo: number;
};

export function applyVerdictToScore(state: ScoreState, verdict: Verdict): ScoreState {
  if (verdict === "miss") {
    return {
      total: state.total,
      combo: 0,
      multiplier: Math.max(MULTIPLIER_MIN, state.multiplier - 1),
    };
  }
  const points = VERDICT_POINTS[verdict] * state.multiplier;
  const combo = state.combo + 1;
  const multiplier = Math.min(MULTIPLIER_MAX, 1 + combo);
  return {
    total: state.total + points,
    combo,
    multiplier,
  };
}
