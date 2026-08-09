import { midiToFreq } from "@/lib/audio/midi-to-freq";
import { hzToMidi } from "@/lib/scoring/pitch";

export type PitchResult = {
  hz: number;
  midi: number;
  cents: number;
  confidence: number;
};

const MIN_RMS = 0.01;
const YIN_THRESHOLD = 0.15;

function computeRms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    sum += buf[i] * buf[i];
  }
  return Math.sqrt(sum / buf.length);
}

function yinPitch(buf: Float32Array, sampleRate: number): { hz: number; confidence: number } | null {
  const halfLen = Math.floor(buf.length / 2);
  if (halfLen < 32) return null;

  const d = new Float32Array(halfLen);
  for (let tau = 0; tau < halfLen; tau++) {
    let sum = 0;
    for (let j = 0; j < halfLen; j++) {
      const diff = buf[j] - buf[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  const cmndf = new Float32Array(halfLen);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfLen; tau++) {
    runningSum += d[tau];
    cmndf[tau] = runningSum > 0 ? (d[tau] * tau) / runningSum : 1;
  }

  const minLag = Math.floor(sampleRate / 1200);
  const maxLag = Math.min(halfLen - 1, Math.floor(sampleRate / 50));

  let bestTau = -1;
  for (let tau = minLag; tau < maxLag; tau++) {
    if (cmndf[tau] < YIN_THRESHOLD) {
      while (tau + 1 < maxLag && cmndf[tau + 1] < cmndf[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  if (bestTau < 0) {
    let minVal = Infinity;
    for (let tau = minLag; tau < maxLag; tau++) {
      if (cmndf[tau] < minVal) {
        minVal = cmndf[tau];
        bestTau = tau;
      }
    }
    if (minVal > 0.5) return null;
  }

  if (bestTau < 1 || bestTau >= halfLen - 1) {
    const hz = sampleRate / bestTau;
    return { hz, confidence: 1 - (cmndf[bestTau] ?? 0.5) };
  }

  const s0 = cmndf[bestTau - 1];
  const s1 = cmndf[bestTau];
  const s2 = cmndf[bestTau + 1];
  const denom = 2 * s1 - s0 - s2;
  const adjustment = denom !== 0 ? (s0 - s2) / (2 * denom) : 0;
  const refinedTau = bestTau + adjustment;

  const hz = sampleRate / refinedTau;
  const confidence = 1 - s1;

  if (hz < 50 || hz > 1200) return null;

  return { hz, confidence };
}

export function detectPitchFromPcm(
  pcm: Float32Array,
  sampleRate: number,
  targetMidi: number,
): PitchResult | null {
  const rms = computeRms(pcm);
  if (rms < MIN_RMS) return null;

  const result = yinPitch(pcm, sampleRate);
  if (!result) return null;

  const midi = hzToMidi(result.hz);
  const targetHz = midiToFreq(targetMidi);
  const cents = 1200 * Math.log2(result.hz / targetHz);

  return {
    hz: result.hz,
    midi,
    cents,
    confidence: result.confidence,
  };
}

export function centsToTargetMidi(hz: number, targetMidi: number): number {
  const targetHz = midiToFreq(targetMidi);
  return 1200 * Math.log2(hz / targetHz);
}

export class PitchSmoother {
  private readonly window: number[] = [];
  private readonly windowSize: number;

  constructor(windowSize = 5) {
    this.windowSize = windowSize;
  }

  push(cents: number): number {
    this.window.push(cents);
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }
    const sorted = [...this.window].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  reset(): void {
    this.window.length = 0;
  }
}

export class InTuneTracker {
  private inTuneStartMs: number | null = null;
  private readonly thresholdCents: number;
  private readonly requiredDurationMs: number;

  constructor(thresholdCents = 5, requiredDurationMs = 1000) {
    this.thresholdCents = thresholdCents;
    this.requiredDurationMs = requiredDurationMs;
  }

  update(cents: number): boolean {
    const now = performance.now();
    const isInTune = Math.abs(cents) <= this.thresholdCents;

    if (isInTune) {
      if (this.inTuneStartMs === null) {
        this.inTuneStartMs = now;
      }
      const duration = now - this.inTuneStartMs;
      return duration >= this.requiredDurationMs;
    } else {
      this.inTuneStartMs = null;
      return false;
    }
  }

  reset(): void {
    this.inTuneStartMs = null;
  }

  getProgress(): number {
    if (this.inTuneStartMs === null) return 0;
    const duration = performance.now() - this.inTuneStartMs;
    return Math.min(1, duration / this.requiredDurationMs);
  }
}
