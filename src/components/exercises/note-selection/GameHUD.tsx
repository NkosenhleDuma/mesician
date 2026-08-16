"use client";

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export type GameHUDProps = {
  score: number;
  streak: number;
  sessionRemainingMs: number;
};

export function GameHUD({ score, streak, sessionRemainingMs }: GameHUDProps) {
  return (
    <div className="grid grid-cols-3 gap-3 text-sm">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
        <div className="text-zinc-400 text-xs">Score</div>
        <div className="text-xl font-semibold text-white tabular-nums">{score}</div>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-center">
        <div className="text-zinc-400 text-xs">Streak</div>
        <div className="text-xl font-semibold text-emerald-400 tabular-nums">{streak}</div>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-right">
        <div className="text-zinc-400 text-xs">Time</div>
        <div className="text-xl font-semibold text-sky-400 tabular-nums">
          {formatTime(sessionRemainingMs)}
        </div>
      </div>
    </div>
  );
}
