/**
 * Lightweight band-restricted YIN (CMNDF) for scoring — NOT full pitch tracker.
 */

export type YinCandidate = {
  hz: number;
  /** CMNDF minimum value (≈ aperiodicity proxy); lower is more periodic */
  cmndfMin: number;
};

/** Expected Hz ± semitoneRadius semitones — restricts lag search for mobile budget */
export function yinAroundExpected(
  buf: Float32Array,
  sampleRate: number,
  expectedHz: number,
  semitoneRadius = 2,
): YinCandidate | null {
  if (expectedHz <= 0 || buf.length < 256) return null;

  const tauCenter = sampleRate / expectedHz;
  const tauMin = Math.max(
    2,
    Math.floor(tauCenter / Math.pow(2, semitoneRadius / 12)),
  );
  const tauMax = Math.min(Math.floor(buf.length / 2) - 1, Math.ceil(tauCenter * Math.pow(2, semitoneRadius / 12)));

  if (tauMax <= tauMin + 2) return null;

  const W = buf.length;
  /** Scratch difference function entries indexed by tau */
  const d = new Float32Array(tauMax + 1);

  for (let tau = tauMin; tau <= tauMax; tau++) {
    let sum = 0;
    const upper = W - tau;
    for (let j = 0; j < upper; j++) {
      const diff = buf[j] - buf[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  let cum = 0;
  let bestTau = tauMin;
  let bestCm = Number.POSITIVE_INFINITY;

  for (let tau = tauMin; tau <= tauMax; tau++) {
    cum += d[tau];
    if (cum < 1e-12) continue;
    const cmndf = (tau * d[tau]) / cum;
    if (cmndf < bestCm) {
      bestCm = cmndf;
      bestTau = tau;
    }
  }

  if (!Number.isFinite(bestCm) || bestCm > 1) return null;

  const hz = sampleRate / bestTau;
  if (hz < 50 || hz > 5000) return null;

  return { hz, cmndfMin: bestCm };
}
