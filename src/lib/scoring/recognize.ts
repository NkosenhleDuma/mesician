import type { StringProfile } from "@/lib/calibration/string-profile";
import {
  expectedMidiWithStringBias,
  getStringProfileEntry,
  monoCentsToleranceWithProfile,
  polySupportThresholdForString,
} from "@/lib/calibration/string-profile";
import type { ChartEvent } from "../chart/types";
import { midiToFreq } from "../audio/midi-to-freq";
import {
  classifyTimingDirected,
  type NoteHit,
  type ScoreEventResult,
  type Verdict,
  type VerdictWindowsOverride,
} from "./engine";
import type { DebugDecisionOutcome, ExpectedEventSnapshot } from "./debug-capture";
import { effectiveOpenStringMidi, hzToMidi } from "./pitch";
import {
  inferMidiFromSpectrum,
  spectrumBandEnergySum,
  sumBandMagnitudes,
} from "./spectrum";
import { yinAroundExpected } from "./yin";

export const POLY_SUPPORT_THRESHOLD = 0.18;

export const MONO_CENTS_TOLERANCE = 50;

/** Reject noisy / unpitched detection */
export const YIN_CMNDF_MAX = 0.2;

const HARM_WEIGHTS = [1.0, 0.6, 0.4, 0.25] as const;

export function midiMatchesEvidence(
  expectedMidi: number,
  evidence: Set<number>,
  semiTolerance = 0.55,
): boolean {
  if (evidence.has(expectedMidi)) return true;
  for (const e of evidence) {
    if (Math.abs(e - expectedMidi) <= semiTolerance) return true;
  }
  return false;
}

export function dominantMidiFromEvidence(evidence: Set<number>): number | null {
  if (evidence.size === 0) return null;
  return [...evidence].sort((a, b) => a - b)[Math.floor(evidence.size / 2)]!;
}

/** True if `evidenceMidi` matches any expected chart MIDI within semitone tolerance. */
export function evidenceMidiMatchesExpected(
  evidenceMidi: number,
  expectedMidis: readonly number[],
  semiTolerance = 0.55,
): boolean {
  for (const ex of expectedMidis) {
    if (Math.abs(evidenceMidi - ex) <= semiTolerance) return true;
  }
  return false;
}

/** Optional overrides for replay / tuning UI; omitted fields use production defaults. */
export type OnsetRecognizerTuning = {
  timingWindows?: VerdictWindowsOverride;
  monoCentsTolerance?: number;
  polySupportThreshold?: number;
  yinCmndfMax?: number;
  /** When profileKey matches chart meta, BP / harmonic mono use per-string bias and thresholds */
  stringProfile?: StringProfile | null;
};

export function noteHarmonicSupport(
  spectrum: Float32Array,
  sampleRate: number,
  midiNote: number,
  normEnergy: number,
): number {
  const f0 = midiToFreq(midiNote);
  let acc = 0;
  for (let h = 1; h <= 4; h++) {
    const f = f0 * h;
    if (f >= sampleRate / 2 - 20) break;
    const w = HARM_WEIGHTS[h - 1] ?? 0;
    acc += w * sumBandMagnitudes(spectrum, sampleRate, f, 0.5);
  }
  return normEnergy > 1e-12 ? acc / normEnergy : 0;
}

export function recognizePolyNotes(
  ev: ChartEvent,
  spectrum: Float32Array,
  sampleRate: number,
  verdict: Verdict,
  timingErrorMs: number,
  supportThreshold = POLY_SUPPORT_THRESHOLD,
): NoteHit[] {
  return recognizePolyNotesWithTrace(
    ev,
    spectrum,
    sampleRate,
    verdict,
    timingErrorMs,
    supportThreshold,
  ).notes;
}

export type PolyRecognizerTrace = {
  kind: "poly";
  normEnergy: number;
  supportThreshold: number;
  perNote: Array<{
    string: number;
    midi: number;
    support: number;
    pitchOk: boolean;
  }>;
};

export function recognizePolyNotesWithTrace(
  ev: ChartEvent,
  spectrum: Float32Array,
  sampleRate: number,
  verdict: Verdict,
  timingErrorMs: number,
  supportThreshold = POLY_SUPPORT_THRESHOLD,
  stringProfile?: StringProfile | null,
): { notes: NoteHit[]; trace: PolyRecognizerTrace } {
  const norm = spectrumBandEnergySum(spectrum, sampleRate);
  const normSafe = norm > 1e-12 ? norm : 1e-12;
  const perNote: PolyRecognizerTrace["perNote"] = [];

  const notes = ev.notes.map((n) => {
    if (n.dead) {
      return {
        string: n.string,
        expectedMidi: n.midi,
        pitchOk: true,
        verdict,
        timingErrorMs,
      };
    }
    const entry = getStringProfileEntry(stringProfile, n.string);
    const th = polySupportThresholdForString(entry, supportThreshold);
    const support = noteHarmonicSupport(spectrum, sampleRate, n.midi, normSafe);
    const pitchOk = norm >= 1e-8 && support >= th;
    perNote.push({
      string: n.string,
      midi: n.midi,
      support,
      pitchOk,
    });
    return {
      string: n.string,
      expectedMidi: n.midi,
      pitchOk,
      verdict,
      timingErrorMs,
    };
  });

  return {
    notes,
    trace: { kind: "poly", normEnergy: norm, supportThreshold, perNote },
  };
}

export type MonoRecognizerTrace = {
  kind: "mono";
  yinHz: number | null;
  cmndfMin: number | null;
  centsPerNote: Array<{
    string: number;
    midi: number;
    cents: number | null;
  }>;
};

export type MonoRecognizeResult = {
  notes: NoteHit[];
  detectedMidi: number | null;
  detectedHz: number | null;
  trace: MonoRecognizerTrace;
};

export function recognizeMonoNotes(
  ev: ChartEvent,
  waveSnippet: Float32Array,
  spectrum: Float32Array,
  sampleRate: number,
  verdict: Verdict,
  timingErrorMs: number,
  tuning?: Pick<OnsetRecognizerTuning, "monoCentsTolerance" | "yinCmndfMax">,
  stringProfile?: StringProfile | null,
): MonoRecognizeResult {
  const centsTolBase = tuning?.monoCentsTolerance ?? MONO_CENTS_TOLERANCE;
  const yinMax = tuning?.yinCmndfMax ?? YIN_CMNDF_MAX;
  const sounding = ev.notes.filter((n) => !n.dead);
  const primary = sounding[0] ?? ev.notes[0];
  const expectedHz = midiToFreq(primary.midi);
  const y = yinAroundExpected(waveSnippet, sampleRate, expectedHz, 2);

  const cmOk = y != null && y.cmndfMin <= yinMax;
  const detectedHz = y?.hz ?? null;
  const detectedMidi =
    detectedHz != null ? hzToMidi(detectedHz) : inferMidiFromSpectrum(spectrum, sampleRate);

  const centsPerNote: MonoRecognizerTrace["centsPerNote"] = [];

  const notes: NoteHit[] = ev.notes.map((n) => {
    if (n.dead) {
      return {
        string: n.string,
        expectedMidi: n.midi,
        pitchOk: true,
        verdict,
        timingErrorMs,
      };
    }
    let pitchOk = false;
    let cents: number | null = null;
    if (y != null) {
      cents = 1200 * Math.log2(y.hz / midiToFreq(n.midi));
    }
    centsPerNote.push({ string: n.string, midi: n.midi, cents });
    if (cmOk && y != null && cents != null) {
      const entry = getStringProfileEntry(stringProfile, n.string);
      const tol = monoCentsToleranceWithProfile(centsTolBase, entry);
      pitchOk = Math.abs(cents) <= tol;
    }
    return {
      string: n.string,
      expectedMidi: n.midi,
      pitchOk,
      verdict,
      timingErrorMs,
    };
  });

  const trace: MonoRecognizerTrace = {
    kind: "mono",
    yinHz: detectedHz,
    cmndfMin: y?.cmndfMin ?? null,
    centsPerNote,
  };

  return { notes, detectedMidi, detectedHz, trace };
}

export type BpRecognizerTrace = {
  kind: "bp";
  evidenceMidis: number[];
  dominantMidi: number | null;
};

/** Result of scoring an onset against one chart event, including tuner/debug traces */
export type ScoreOnsetAgainstEventResult = ScoreEventResult & {
  trace: MonoRecognizerTrace | PolyRecognizerTrace | BpRecognizerTrace;
  isPoly: boolean;
};

export function scoreOnsetAgainstEvent(
  ev: ChartEvent,
  songTimeSec: number,
  waveSnippet: Float32Array,
  spectrum: Float32Array,
  sampleRate: number,
  inputLatencyMs: number,
  tuning?: OnsetRecognizerTuning,
): ScoreOnsetAgainstEventResult {
  const tMs = songTimeSec * 1000;
  const centerMs = ev.t0 * 1000;
  const timingErrorMs = tMs + inputLatencyMs - centerMs;
  const noteDurSec = Math.max(0, ev.t1 - ev.t0);
  const verdict = classifyTimingDirected(timingErrorMs, noteDurSec, tuning?.timingWindows);

  const sounding = ev.notes.filter((n) => !n.dead);
  const usePoly = sounding.length > 1;
  const polyTh = tuning?.polySupportThreshold ?? POLY_SUPPORT_THRESHOLD;

  if (usePoly) {
    const { notes, trace } = recognizePolyNotesWithTrace(
      ev,
      spectrum,
      sampleRate,
      verdict,
      timingErrorMs,
      polyTh,
      tuning?.stringProfile ?? null,
    );
    const dm = inferMidiFromSpectrum(spectrum, sampleRate);
    const hz = dm != null ? midiToFreq(dm) : null;
    return {
      eventId: ev.id,
      detectedMidi: dm,
      detectedHz: hz,
      notes,
      trace,
      isPoly: true,
    };
  }

  const mono = recognizeMonoNotes(
    ev,
    waveSnippet,
    spectrum,
    sampleRate,
    verdict,
    timingErrorMs,
    tuning,
    tuning?.stringProfile ?? null,
  );
  return {
    eventId: ev.id,
    detectedMidi: mono.detectedMidi,
    detectedHz: mono.detectedHz,
    notes: mono.notes,
    trace: mono.trace,
    isPoly: false,
  };
}

/** Score timing from transport + spectral onset; pitches from stabilized Basic Pitch evidence. */
export function scoreBpOnsetAgainstEvent(
  ev: ChartEvent,
  songTimeSec: number,
  evidenceMidis: Set<number>,
  inputLatencyMs: number,
  tuning?: OnsetRecognizerTuning,
): ScoreOnsetAgainstEventResult {
  const tMs = songTimeSec * 1000;
  const centerMs = ev.t0 * 1000;
  const timingErrorMs = tMs + inputLatencyMs - centerMs;
  const noteDurSec = Math.max(0, ev.t1 - ev.t0);
  const verdict = classifyTimingDirected(timingErrorMs, noteDurSec, tuning?.timingWindows);

  const notes = ev.notes.map((n) => {
    if (n.dead) {
      return {
        string: n.string,
        expectedMidi: n.midi,
        pitchOk: true,
        verdict,
        timingErrorMs,
      };
    }
    const entry = getStringProfileEntry(tuning?.stringProfile ?? null, n.string);
    const expectedAdj = expectedMidiWithStringBias(n.midi, entry);
    const pitchOk = midiMatchesEvidence(expectedAdj, evidenceMidis);
    return {
      string: n.string,
      expectedMidi: n.midi,
      pitchOk,
      verdict,
      timingErrorMs,
    };
  });

  const dom = dominantMidiFromEvidence(evidenceMidis);
  const hz = dom != null ? midiToFreq(dom) : null;

  return {
    eventId: ev.id,
    detectedMidi: dom,
    detectedHz: hz,
    notes,
    trace: {
      kind: "bp",
      evidenceMidis: [...evidenceMidis].sort((a, b) => a - b),
      dominantMidi: dom,
    },
    isPoly: ev.notes.filter((n) => !n.dead).length > 1,
  };
}

/** Capo-aware string/fret hint from sounding MIDI vs tuning */
export function inferPlayedStringFret(
  detectedMidi: number,
  tuning: string[],
  capoFret?: number | null,
): { string: number; fret: number } | null {
  let best: { string: number; fret: number; score: number } | null = null;
  const cap = capoFret ?? 0;
  for (let s = 1; s <= 6; s++) {
    const open = effectiveOpenStringMidi(tuning, s, cap);
    if (open == null) continue;
    const delta = detectedMidi - open;
    const fret = Math.round(delta);
    if (Math.abs(delta - fret) > 0.35) continue;
    if (fret < 0 || fret > 24) continue;
    const score = Math.abs(delta - fret);
    if (!best || score < best.score) best = { string: s, fret, score };
  }
  return best ? { string: best.string, fret: best.fret } : null;
}

export function expectedSnapshotToChartEvent(e: ExpectedEventSnapshot): ChartEvent {
  const kind = e.kind === "chord" ? "chord" : "note";
  const t1 = e.t1 != null && e.t1 >= e.t0 ? e.t1 : e.t0;
  return {
    id: e.id,
    t0: e.t0,
    t1,
    kind,
    notes: e.notes.map((n) => ({
      string: n.string,
      fret: 0,
      midi: n.midi,
      dead: n.dead ?? false,
      ...(n.palmMute ? { palmMute: true } : {}),
    })),
    ...(e.tech?.length ? { tech: e.tech } : {}),
  };
}

/**
 * Mirrors live mic debug labeling in PracticeClient — after scoring an onset against `ev`;
 * `appliedPitchHit` means at least one sounding string was accepted as in-time + in-tune.
 */
export function classifyOnsetDebugOutcome(
  appliedPitchHit: boolean,
  r: ScoreOnsetAgainstEventResult,
  ev: ChartEvent,
): DebugDecisionOutcome {
  if (appliedPitchHit) return "accepted";

  const verdict = r.notes[0]?.verdict ?? "miss";
  let anyPitchOkSounding = false;
  for (let i = 0; i < ev.notes.length; i++) {
    const cn = ev.notes[i];
    const nh = r.notes[i];
    if (!cn || !nh || cn.dead) continue;
    if (nh.pitchOk) anyPitchOkSounding = true;
  }

  if (verdict === "miss" && anyPitchOkSounding) return "timing-miss";
  return "wrong-pitch";
}
