"use client";

import { useMemo, useState } from "react";
import { NOTE_GAME_CONFIG } from "@/lib/exercises/note-selection/config";
import { modeLabel } from "@/lib/exercises/note-selection/challenge-generator";
import type {
  DifficultyId,
  GameMode,
  NoteGameSessionResult,
} from "@/lib/exercises/note-selection/types";

export type HistorySession = {
  id: string;
  startedAt: string;
  endedAt: string;
  config: NoteGameSessionResult["config"];
  result: NoteGameSessionResult;
};

export type NoteGameHistoryProps = {
  sessions: HistorySession[];
  onBack: () => void;
  loading?: boolean;
};

type ChartMetric = "scorePerMinute" | "accuracy" | "medianResponseTimeMs" | "bestStreak";

function SimpleLineChart({
  title,
  series,
  yLabel,
  invertY = false,
}: {
  title: string;
  series: { label: string; color: string; points: { x: number; y: number }[] }[];
  yLabel: string;
  invertY?: boolean;
}) {
  const width = 640;
  const height = 180;
  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <div className="text-sm font-medium text-zinc-300">{title}</div>
        <div className="mt-6 text-sm text-zinc-500">No data yet</div>
      </div>
    );
  }

  const minX = Math.min(...allPoints.map((p) => p.x));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxY = Math.max(...allPoints.map((p) => p.y));
  const yRange = maxY - minY || 1;

  const sx = (x: number) => pad.left + ((x - minX) / (maxX - minX || 1)) * innerW;
  const sy = (y: number) => {
    const t = (y - minY) / yRange;
    const norm = invertY ? t : 1 - t;
    return pad.top + norm * innerH;
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-center justify-between gap-4 mb-2">
        <div className="text-sm font-medium text-zinc-300">{title}</div>
        <div className="text-xs text-zinc-500">{yLabel}</div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        {series.map((s) => {
          if (s.points.length < 2) return null;
          const d = s.points
            .sort((a, b) => a.x - b.x)
            .map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`)
            .join(" ");
          return (
            <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth={2} />
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-400">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const DIFF_COLORS: Record<DifficultyId, string> = {
  beginner: "#86efac",
  easy: "#7dd3fc",
  medium: "#fde047",
  hard: "#fb923c",
  expert: "#f87171",
};

export function NoteGameHistory({ sessions, onBack, loading }: NoteGameHistoryProps) {
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyId | "all">("all");
  const [modeFilter, setModeFilter] = useState<GameMode | "all">("all");
  const [metric, setMetric] = useState<ChartMetric>("scorePerMinute");

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (difficultyFilter !== "all" && s.config.difficulty !== difficultyFilter) return false;
      if (modeFilter !== "all" && s.config.mode !== modeFilter) return false;
      return true;
    });
  }, [sessions, difficultyFilter, modeFilter]);

  const chartSeries = useMemo(() => {
    const byDifficulty = new Map<DifficultyId, { x: number; y: number }[]>();
    for (const s of filtered) {
      const d = s.config.difficulty;
      const arr = byDifficulty.get(d) ?? [];
      const x = new Date(s.startedAt).getTime();
      let y = 0;
      switch (metric) {
        case "scorePerMinute":
          y = s.result.scorePerMinute;
          break;
        case "accuracy":
          y = s.result.accuracy * 100;
          break;
        case "medianResponseTimeMs":
          y = s.result.medianResponseTimeMs ?? 0;
          break;
        case "bestStreak":
          y = s.result.bestStreak;
          break;
      }
      arr.push({ x, y });
      byDifficulty.set(d, arr);
    }

    return NOTE_GAME_CONFIG.difficulties.map((d) => ({
      label: d.label,
      color: DIFF_COLORS[d.id],
      points: byDifficulty.get(d.id) ?? [],
    }));
  }, [filtered, metric]);

  const metricLabel =
    metric === "scorePerMinute"
      ? "Score / min"
      : metric === "accuracy"
        ? "Accuracy %"
        : metric === "medianResponseTimeMs"
          ? "Median response (ms)"
          : "Best streak";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-white">History</h2>
          <p className="text-sm text-zinc-400">Track progress over time by difficulty.</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
        >
          Back
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={difficultyFilter}
          onChange={(e) => setDifficultyFilter(e.target.value as DifficultyId | "all")}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          <option value="all">All difficulties</option>
          {NOTE_GAME_CONFIG.difficulties.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <select
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value as GameMode | "all")}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          <option value="all">All modes</option>
          {(["single-string", "region", "wide"] as const).map((m) => (
            <option key={m} value={m}>
              {modeLabel(m)}
            </option>
          ))}
        </select>
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value as ChartMetric)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          <option value="scorePerMinute">Score per minute</option>
          <option value="accuracy">Accuracy</option>
          <option value="medianResponseTimeMs">Median response time</option>
          <option value="bestStreak">Best streak</option>
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">Loading history…</div>
      ) : (
        <SimpleLineChart
          title="Performance over time"
          yLabel={metricLabel}
          series={chartSeries}
          invertY={metric === "medianResponseTimeMs"}
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-900/80 text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Mode</th>
              <th className="px-3 py-2 text-left font-medium">Difficulty</th>
              <th className="px-3 py-2 text-right font-medium">Score</th>
              <th className="px-3 py-2 text-right font-medium">Pts/min</th>
              <th className="px-3 py-2 text-right font-medium">Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No sessions yet
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr key={s.id} className="border-t border-zinc-800/80">
                  <td className="px-3 py-2 text-zinc-300">
                    {new Date(s.startedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{modeLabel(s.config.mode)}</td>
                  <td className="px-3 py-2 text-zinc-400 capitalize">{s.config.difficulty}</td>
                  <td className="px-3 py-2 text-right text-white tabular-nums">
                    {s.result.score}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-300 tabular-nums">
                    {s.result.scorePerMinute}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-300 tabular-nums">
                    {Math.round(s.result.accuracy * 100)}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
