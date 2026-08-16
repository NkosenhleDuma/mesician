"use client";

import { getDifficulty } from "@/lib/exercises/note-selection/config";
import type { DifficultyId } from "@/lib/exercises/note-selection/types";

export type ChallengeDisplayProps = {
  displayName: string;
  modeLabel: string;
  stringNumber?: number;
  regionName?: string;
  challengeRemainingMs: number;
  difficulty: DifficultyId;
  feedback: "correct" | "incorrect" | "timeout" | null;
};

export function ChallengeDisplay({
  displayName,
  modeLabel,
  stringNumber,
  regionName,
  challengeRemainingMs,
  difficulty,
  feedback,
}: ChallengeDisplayProps) {
  const answerWindowMs = getDifficulty(difficulty).answerWindowMs;
  const ratio = Math.max(0, Math.min(1, challengeRemainingMs / answerWindowMs));
  const dots = 5;
  const filled = Math.ceil(ratio * dots);

  const feedbackClass =
    feedback === "correct"
      ? "text-emerald-400"
      : feedback === "incorrect"
        ? "text-red-400"
        : feedback === "timeout"
          ? "text-amber-400"
          : "text-white";

  return (
    <div className="text-center space-y-3">
      <div className="text-xs uppercase tracking-widest text-zinc-500">Find</div>
      <div className={`text-6xl sm:text-7xl font-bold tracking-tight ${feedbackClass}`}>
        {feedback === "timeout" ? "Timeout" : displayName}
      </div>
      <div className="flex justify-center gap-1.5">
        {Array.from({ length: dots }).map((_, i) => (
          <span
            key={i}
            className={`h-2.5 w-2.5 rounded-full ${
              i < filled ? "bg-sky-400" : "bg-zinc-700"
            }`}
          />
        ))}
      </div>
      <div className="text-sm text-zinc-400">
        {modeLabel}
        {stringNumber != null && ` · String ${stringNumber}`}
        {regionName && ` · ${regionName}`}
      </div>
    </div>
  );
}
