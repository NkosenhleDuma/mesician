"use client";

import { getDifficulty } from "@/lib/exercises/note-selection/config";
import { modeLabel } from "@/lib/exercises/note-selection/challenge-generator";
import type { NoteGameSessionResult } from "@/lib/exercises/note-selection/types";

export type NoteGameResultsProps = {
  result: NoteGameSessionResult;
  onPlayAgain: () => void;
  onViewHistory: () => void;
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(2)}s`;
}

export function NoteGameResults({ result, onPlayAgain, onViewHistory }: NoteGameResultsProps) {
  const difficultyLabel = getDifficulty(result.config.difficulty).label;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-white">Session complete</h2>
        <p className="mt-1 text-zinc-400 text-sm">
          {difficultyLabel} · {modeLabel(result.config.mode)} · {result.config.durationSec / 60}{" "}
          min
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <div className="text-sm text-zinc-400">Final score</div>
        <div className="text-5xl font-bold text-sky-400 tabular-nums">{result.score}</div>
        <div className="mt-1 text-sm text-zinc-500">
          {result.scorePerMinute} pts/min
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Correct" value={String(result.correct)} />
        <Stat label="Timeouts" value={String(result.timeouts)} />
        <Stat label="Wrong notes" value={String(result.wrongNotes)} />
        <Stat label="Accuracy" value={pct(result.accuracy)} />
        <Stat label="Avg response" value={formatMs(result.avgResponseTimeMs)} />
        <Stat label="Median response" value={formatMs(result.medianResponseTimeMs)} />
        <Stat label="Best streak" value={String(result.bestStreak)} />
        <Stat label="Challenges" value={String(result.challengesPresented)} />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onPlayAgain}
          className="rounded-md bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          Play again
        </button>
        <button
          type="button"
          onClick={onViewHistory}
          className="rounded-md border border-zinc-700 px-5 py-2.5 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
        >
          View history
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-lg font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
}
