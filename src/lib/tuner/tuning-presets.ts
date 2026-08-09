import { Note } from "tonal";

export type TuningPreset = {
  id: string;
  name: string;
  /** String notes from low to high (string 6 to string 1) */
  strings: string[];
};

export const TUNING_PRESETS: TuningPreset[] = [
  { id: "standard", name: "Standard E", strings: ["E2", "A2", "D3", "G3", "B3", "E4"] },
  { id: "eb-standard", name: "Eb Standard", strings: ["Eb2", "Ab2", "Db3", "Gb3", "Bb3", "Eb4"] },
  { id: "d-standard", name: "D Standard", strings: ["D2", "G2", "C3", "F3", "A3", "D4"] },
  { id: "drop-d", name: "Drop D", strings: ["D2", "A2", "D3", "G3", "B3", "E4"] },
  { id: "drop-c", name: "Drop C", strings: ["C2", "G2", "C3", "F3", "A3", "D4"] },
  { id: "open-g", name: "Open G", strings: ["D2", "G2", "D3", "G3", "B3", "D4"] },
  { id: "dadgad", name: "DADGAD", strings: ["D2", "A2", "D3", "G3", "A3", "D4"] },
];

export function getTuningPreset(id: string): TuningPreset | undefined {
  return TUNING_PRESETS.find((p) => p.id === id);
}

export function tuningStringMidis(tuning: TuningPreset): (number | null)[] {
  return tuning.strings.map((note) => {
    const midi = Note.midi(note);
    return typeof midi === "number" ? midi : null;
  });
}

export function getStringMidi(tuning: TuningPreset, stringIndex: number): number | null {
  const note = tuning.strings[stringIndex];
  if (!note) return null;
  const midi = Note.midi(note);
  return typeof midi === "number" ? midi : null;
}
