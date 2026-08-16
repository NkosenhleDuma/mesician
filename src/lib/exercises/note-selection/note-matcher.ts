import type { NoteChallenge } from "./types";
import { pitchClassFromMidi } from "./fretboard-model";

export type MatchResult =
  | { kind: "correct"; pitchClass: number; pitchMidi: number }
  | { kind: "incorrect"; pitchClass: number; pitchMidi: number }
  | { kind: "ignored"; reason: "duplicate" | "no-challenge" };

export function matchDetectedNote(
  challenge: NoteChallenge | null,
  pitchMidi: number,
  lastHandled: { pitchMidi: number; timestamp: number } | null,
  nowMs: number,
  guardMs: number,
): MatchResult {
  if (!challenge) return { kind: "ignored", reason: "no-challenge" };

  const roundedMidi = Math.round(pitchMidi);
  const pitchClass = pitchClassFromMidi(roundedMidi);

  if (
    lastHandled &&
    lastHandled.pitchMidi === roundedMidi &&
    nowMs - lastHandled.timestamp < guardMs
  ) {
    return { kind: "ignored", reason: "duplicate" };
  }

  if (pitchClass === challenge.targetPitchClass) {
    return { kind: "correct", pitchClass, pitchMidi: roundedMidi };
  }

  return { kind: "incorrect", pitchClass, pitchMidi: roundedMidi };
}
