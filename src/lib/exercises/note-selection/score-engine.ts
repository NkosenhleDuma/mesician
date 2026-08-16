import { NOTE_GAME_CONFIG, getDifficulty } from "./config";
import type { ChallengeResult, DifficultyId } from "./types";

export function streakMultiplier(streak: number): number {
  const thresholds = NOTE_GAME_CONFIG.scoring.streakThresholds;
  let mult = 1;
  for (const t of thresholds) {
    if (streak >= t.minStreak) mult = t.multiplier;
  }
  return mult;
}

export function computeCorrectScore(
  difficultyId: DifficultyId,
  responseTimeMs: number,
  streak: number,
): number {
  const difficulty = getDifficulty(difficultyId);
  const { baseCorrectPoints, maxSpeedBonus } = NOTE_GAME_CONFIG.scoring;
  const answerWindowMs = difficulty.answerWindowMs;

  const remainingRatio = Math.max(0, answerWindowMs - responseTimeMs) / answerWindowMs;
  const baseScore = baseCorrectPoints + maxSpeedBonus * remainingRatio;
  const streakMult = streakMultiplier(streak);

  return Math.round(baseScore * difficulty.scoreMultiplier * streakMult);
}

export function computeWrongNotePenalty(difficultyId: DifficultyId): number {
  const difficulty = getDifficulty(difficultyId);
  return Math.round(NOTE_GAME_CONFIG.scoring.wrongNotePenalty * difficulty.scoreMultiplier);
}

export function applyWrongNotePenalty(currentScore: number, difficultyId: DifficultyId): number {
  const penalty = computeWrongNotePenalty(difficultyId);
  return Math.max(0, currentScore - penalty);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return sorted[mid]!;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function computeSessionAccuracy(results: ChallengeResult[]): number {
  const completed = results.filter((r) => r.result === "correct" || r.result === "timeout");
  if (completed.length === 0) return 0;
  const correct = completed.filter((r) => r.result === "correct").length;
  return correct / completed.length;
}

export function computeScorePerMinute(score: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  return Math.round((score / durationSec) * 60);
}
