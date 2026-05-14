import { Chord, Midi } from "tonal";

/**
 * Short chord symbol from MIDI pitches (e.g. for highway display).
 * When `capoFret` is set, subtracts it so the label matches the fingered shape.
 */
export function chordLabelFromMidis(midis: number[], capoFret?: number | null): string | null {
  if (midis.length < 2) return null;
  const cap = capoFret != null && capoFret > 0 ? capoFret : 0;
  const adjusted = cap > 0 ? midis.map((m) => m - cap) : midis;
  const names = [...new Set(adjusted.map((m) => Midi.midiToNoteName(m)))];
  const detected = Chord.detect(names);
  return detected[0] ?? null;
}
