import type {
  AccidentalMode,
  DifficultyId,
  DifficultyPreset,
  FretboardRegion,
  FretboardRegionId,
  SessionDurationSec,
} from "./types";

export const NOTE_GAME_CONFIG = {
  durationsSec: [60, 180, 300, 600] as SessionDurationSec[],

  revealDurationMs: 1200,

  duplicateInputGuardMs: 150,

  recentHistorySize: 8,

  scoring: {
    baseCorrectPoints: 100,
    maxSpeedBonus: 100,
    wrongNotePenalty: 25,
    streakThresholds: [
      { minStreak: 0, multiplier: 1.0 },
      { minStreak: 3, multiplier: 1.1 },
      { minStreak: 6, multiplier: 1.25 },
      { minStreak: 10, multiplier: 1.5 },
      { minStreak: 20, multiplier: 2.0 },
    ],
  },

  difficulties: [
    { id: "beginner", label: "Beginner", answerWindowMs: 6000, scoreMultiplier: 1.0 },
    { id: "easy", label: "Easy", answerWindowMs: 4500, scoreMultiplier: 1.2 },
    { id: "medium", label: "Medium", answerWindowMs: 3000, scoreMultiplier: 1.5 },
    { id: "hard", label: "Hard", answerWindowMs: 2000, scoreMultiplier: 2.0 },
    { id: "expert", label: "Expert", answerWindowMs: 1200, scoreMultiplier: 3.0 },
  ] satisfies DifficultyPreset[],

  regions: [
    {
      id: "lower-open",
      name: "Lower / Open",
      minString: 1,
      maxString: 6,
      minFret: 0,
      maxFret: 4,
    },
    {
      id: "low-mid",
      name: "Low-Mid",
      minString: 1,
      maxString: 6,
      minFret: 3,
      maxFret: 7,
    },
    {
      id: "middle",
      name: "Middle",
      minString: 1,
      maxString: 6,
      minFret: 5,
      maxFret: 9,
    },
    {
      id: "upper-mid",
      name: "Upper-Mid",
      minString: 1,
      maxString: 6,
      minFret: 8,
      maxFret: 12,
    },
    {
      id: "treble-strings",
      name: "Treble Strings",
      minString: 1,
      maxString: 3,
      minFret: 0,
      maxFret: 12,
    },
    {
      id: "bass-strings",
      name: "Bass Strings",
      minString: 4,
      maxString: 6,
      minFret: 0,
      maxFret: 12,
    },
  ] satisfies FretboardRegion[],
} as const;

export const NATURAL_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11] as const;

export const ALL_PITCH_CLASSES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/** Sharp spellings for display (index = pitch class). */
export const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** Flat spellings for enharmonic display variety. */
export const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;

export function getDifficulty(id: DifficultyId): DifficultyPreset {
  const d = NOTE_GAME_CONFIG.difficulties.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown difficulty: ${id}`);
  return d;
}

export function getRegion(id: FretboardRegionId): FretboardRegion {
  const r = NOTE_GAME_CONFIG.regions.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown region: ${id}`);
  return r;
}

export function getPitchClassesForAccidentalMode(mode: AccidentalMode): readonly number[] {
  return mode === "naturals" ? NATURAL_PITCH_CLASSES : ALL_PITCH_CLASSES;
}

export function displayNameForPitchClass(pitchClass: number, useFlat = false): string {
  const idx = ((pitchClass % 12) + 12) % 12;
  return useFlat ? FLAT_NAMES[idx]! : SHARP_NAMES[idx]!;
}

export function randomDisplayNameForPitchClass(pitchClass: number): string {
  const idx = ((pitchClass % 12) + 12) % 12;
  const hasEnharmonic = [1, 3, 6, 8, 10].includes(idx);
  if (hasEnharmonic && Math.random() < 0.5) return FLAT_NAMES[idx]!;
  return SHARP_NAMES[idx]!;
}
