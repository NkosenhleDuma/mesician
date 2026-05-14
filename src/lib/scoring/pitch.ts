import { Note } from "tonal";

/** Parse chart tuning strings (e.g. `"E2"`) to MIDI; index order follows chart `meta.tuning` (typically string 6..1). */
export function tuningMidis(tuning: string[]): (number | null)[] {
  return tuning.map((t) => {
    const m = Note.midi(t);
    return typeof m === "number" ? m : null;
  });
}

/**
 * Open-string MIDI for GP string index 1–6 (string 1 = high E in this app).
 * Assumes `tuning` has length 6 with index 0 = low E (string 6) … index 5 = high E (string 1).
 */
export function openStringMidi(tuning: string[], gpString: number): number | null {
  const midis = tuningMidis(tuning);
  if (midis.length !== 6 || gpString < 1 || gpString > 6) return null;
  const idx = midis.length - gpString;
  return midis[idx] ?? null;
}

/**
 * Sounding MIDI at fret 0 for this string (chart tuning + optional capo).
 * Chart note MIDIs use AlphaTab `realValue` (already sounding pitch); use this only for fret/string inference UI.
 */
export function effectiveOpenStringMidi(
  tuning: string[],
  gpString: number,
  capoFret?: number | null,
): number | null {
  const base = openStringMidi(tuning, gpString);
  if (base == null) return null;
  const cap =
    typeof capoFret === "number" && capoFret > 0 ? Math.round(capoFret) : 0;
  return base + cap;
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}
