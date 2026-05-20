import { midiToFreq } from "@/lib/audio/midi-to-freq";
import { hzToMidi } from "@/lib/scoring/pitch";

export type StringProfileEntry = {
  gpString: number;
  expectedMidi: number;
  detectedMidi: number;
  centsBias: number;
  rmsMedian: number;
  harmonicSupportMedian: number;
  sampleCount: number;
};

/** v1 persisted in localStorage and debug meta */
export type StringProfile = {
  version: 1;
  profileKey: string;
  tuning: string[];
  capoFret: number | null;
  capturedAtIso: string;
  strings: StringProfileEntry[];
};

const PROFILE_VERSION = 1 as const;

/** Simple deterministic key from tuning + capo (ASCII). */
export function stringProfileKey(tuning: string[], capoFret: number | null | undefined): string {
  const cap = typeof capoFret === "number" && capoFret > 0 ? Math.round(capoFret) : 0;
  const s = [...tuning].join("|") + ":" + String(cap);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) + h + s.charCodeAt(i)!;
    h >>>= 0;
  }
  return "pk_" + (h >>> 0).toString(16);
}

export function blankStringProfile(meta: {
  tuning: string[];
  capoFret: number | null | undefined;
  capturedAtIso: string;
}): StringProfile {
  return {
    version: PROFILE_VERSION,
    profileKey: stringProfileKey(meta.tuning, meta.capoFret),
    tuning: [...meta.tuning],
    capoFret:
      typeof meta.capoFret === "number" && meta.capoFret > 0 ? Math.round(meta.capoFret) : null,
    capturedAtIso: meta.capturedAtIso,
    strings: [],
  };
}

export function getStringProfileEntry(
  profile: StringProfile | null | undefined,
  gpString: number,
): StringProfileEntry | undefined {
  if (!profile) return undefined;
  return profile.strings.find((e) => e.gpString === gpString);
}

/** Chart expected midi adjusted by user's median cents bias (what we compare evidence against). */
export function expectedMidiWithStringBias(chartMidi: number, entry: StringProfileEntry | undefined): number {
  if (!entry || !Number.isFinite(entry.centsBias)) return chartMidi;
  const hz = midiToFreq(chartMidi) * 2 ** (entry.centsBias / 1200);
  return hzToMidi(hz);
}

/** Per-string poly harmonic support threshold; falls back to global default. */
export function polySupportThresholdForString(
  entry: StringProfileEntry | undefined,
  globalDefault: number,
): number {
  if (
    !entry ||
    entry.sampleCount < 1 ||
    !Number.isFinite(entry.harmonicSupportMedian) ||
    entry.harmonicSupportMedian <= 0
  ) {
    return globalDefault;
  }
  return Math.max(0.08, entry.harmonicSupportMedian * 0.7);
}

/** Widen mono tolerance by profile (capped). */
export function monoCentsToleranceWithProfile(
  baseTolerance: number,
  entry: StringProfileEntry | undefined,
): number {
  if (!entry || entry.sampleCount < 1 || !Number.isFinite(entry.centsBias)) return baseTolerance;
  return baseTolerance + Math.min(25, Math.abs(entry.centsBias));
}

export type CalibrationSamplePayload = {
  gpString: number;
  expectedMidi: number;
  detectedMidi: number;
  centsError: number;
  rms: number;
  harmonicSupport: number;
};

const MERGE_ALPHA = 0.35;

/** Merge one successful calibration observation into profile (EMA). Returns updated profile. */
export function mergeStringProfileSample(profile: StringProfile, sample: CalibrationSamplePayload): StringProfile {
  const idx = profile.strings.findIndex((e) => e.gpString === sample.gpString);
  const now = new Date().toISOString();

  const makeEntry = (): StringProfileEntry => ({
    gpString: sample.gpString,
    expectedMidi: sample.expectedMidi,
    detectedMidi: sample.detectedMidi,
    centsBias: sample.centsError,
    rmsMedian: sample.rms,
    harmonicSupportMedian: sample.harmonicSupport,
    sampleCount: 1,
  });

  if (idx < 0) {
    return {
      ...profile,
      capturedAtIso: now,
      strings: [...profile.strings, makeEntry()],
    };
  }

  const prev = profile.strings[idx]!;
  const n = prev.sampleCount + 1;
  const a = MERGE_ALPHA;
  const centsBias =
    prev.sampleCount <= 1
      ? (prev.centsBias + sample.centsError) / 2
      : prev.centsBias * (1 - a) + sample.centsError * a;
  const detectedMidi =
    prev.sampleCount <= 1
      ? (prev.detectedMidi + sample.detectedMidi) / 2
      : prev.detectedMidi * (1 - a) + sample.detectedMidi * a;
  const rmsMedian = prev.rmsMedian * (1 - a) + sample.rms * a;
  const harmonicSupportMedian =
    prev.harmonicSupportMedian * (1 - a) + sample.harmonicSupport * a;

  const nextStrings = [...profile.strings];
  nextStrings[idx] = {
    ...prev,
    expectedMidi: sample.expectedMidi,
    centsBias,
    detectedMidi,
    rmsMedian,
    harmonicSupportMedian,
    sampleCount: n,
  };
  return { ...profile, capturedAtIso: now, strings: nextStrings };
}

export function profileMatchesChartMeta(
  profile: StringProfile,
  tuning: string[],
  capoFret: number | null | undefined,
): boolean {
  return profile.profileKey === stringProfileKey(tuning, capoFret);
}
