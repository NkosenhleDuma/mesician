import type { FretboardLength, FretboardRegion, FretPosition } from "./types";

/** Standard tuning: string 1 (high E) through string 6 (low E). */
export const STANDARD_TUNING: Record<number, number> = {
  1: 64, // E4
  2: 59, // B3
  3: 55, // G3
  4: 50, // D3
  5: 45, // A2
  6: 40, // E2
};

export const STRING_LABELS: Record<number, string> = {
  1: "E",
  2: "B",
  3: "G",
  4: "D",
  5: "A",
  6: "E",
};

export function pitchClassFromMidi(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

export function positionAt(string: number, fret: number): FretPosition {
  const openMidi = STANDARD_TUNING[string];
  if (openMidi == null) throw new Error(`Invalid string: ${string}`);
  const midiPitch = openMidi + fret;
  return {
    string,
    fret,
    midiPitch,
    pitchClass: pitchClassFromMidi(midiPitch),
  };
}

export function clipRegionToFretboardLength(
  region: FretboardRegion,
  fretboardLength: FretboardLength,
): FretboardRegion | null {
  const maxFret = Math.min(region.maxFret, fretboardLength);
  if (region.minFret > maxFret) return null;
  return { ...region, maxFret };
}

export function getAllPositions(fretboardLength: FretboardLength): FretPosition[] {
  const positions: FretPosition[] = [];
  for (let s = 1; s <= 6; s++) {
    for (let f = 0; f <= fretboardLength; f++) {
      positions.push(positionAt(s, f));
    }
  }
  return positions;
}

export function filterPositionsByRegion(
  positions: FretPosition[],
  region: FretboardRegion,
): FretPosition[] {
  return positions.filter(
    (p) =>
      p.string >= region.minString &&
      p.string <= region.maxString &&
      p.fret >= region.minFret &&
      p.fret <= region.maxFret,
  );
}

export function filterPositionsByString(positions: FretPosition[], string: number): FretPosition[] {
  return positions.filter((p) => p.string === string);
}

export function getPositionsForPitchClass(
  pitchClass: number,
  allowedPositions: FretPosition[],
): FretPosition[] {
  const pc = ((pitchClass % 12) + 12) % 12;
  return allowedPositions.filter((p) => p.pitchClass === pc);
}

export function uniquePitchClassesInPositions(positions: FretPosition[]): number[] {
  const set = new Set<number>();
  for (const p of positions) set.add(p.pitchClass);
  return [...set].sort((a, b) => a - b);
}

export function challengeIdentity(challenge: {
  targetPitchClass: number;
  mode: string;
  string?: number;
  regionId?: string;
}): string {
  if (challenge.mode === "single-string") {
    return `${challenge.mode}:${challenge.targetPitchClass}:${challenge.string ?? "?"}`;
  }
  if (challenge.mode === "region") {
    return `${challenge.mode}:${challenge.targetPitchClass}:${challenge.regionId ?? "?"}`;
  }
  return `${challenge.mode}:${challenge.targetPitchClass}`;
}
