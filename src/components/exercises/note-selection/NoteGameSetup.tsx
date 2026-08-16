"use client";

import { NOTE_GAME_CONFIG } from "@/lib/exercises/note-selection/config";
import { modeLabel } from "@/lib/exercises/note-selection/challenge-generator";
import {
  DEFAULT_NOTE_GAME_CONFIG,
  getStoredNoteGameConfig,
  setStoredNoteGameConfig,
} from "@/lib/exercises/note-selection/storage";
import type { NoteGameSessionConfig } from "@/lib/exercises/note-selection/types";
import { useState } from "react";

export type NoteGameSetupProps = {
  onStart: (config: NoteGameSessionConfig) => void;
  onViewHistory: () => void;
  micError: string | null;
  onRequestMic: () => void;
};

function durationLabel(sec: number): string {
  if (sec === 60) return "1 min";
  if (sec === 180) return "3 min";
  if (sec === 300) return "5 min";
  return "10 min";
}

export function NoteGameSetup({
  onStart,
  onViewHistory,
  micError,
  onRequestMic,
}: NoteGameSetupProps) {
  const [config, setConfig] = useState<NoteGameSessionConfig>(() => getStoredNoteGameConfig());

  const update = (partial: Partial<NoteGameSessionConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      setStoredNoteGameConfig(next);
      return next;
    });
  };

  const handleStart = () => {
    setStoredNoteGameConfig(config);
    onStart(config);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Note Selection</h1>
        <p className="mt-2 text-zinc-400 text-sm max-w-xl">
          Find the requested note on your guitar. Play the correct pitch before the timer runs out.
          Wrong notes cost points but keep the challenge active.
        </p>
      </div>

      {micError && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {micError}{" "}
          <button type="button" onClick={onRequestMic} className="underline hover:text-red-200">
            Retry mic
          </button>
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-300">Mode</legend>
          <div className="flex flex-wrap gap-2">
            {(["single-string", "region", "wide"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => update({ mode })}
                className={`rounded-md px-3 py-2 text-sm border ${
                  config.mode === mode
                    ? "border-sky-500 bg-sky-950/40 text-sky-200"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {modeLabel(mode)}
              </button>
            ))}
          </div>
        </fieldset>

        {config.mode === "region" && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-zinc-300">Region</legend>
            <select
              value={config.regionId ?? "middle"}
              onChange={(e) =>
                update({ regionId: e.target.value as NoteGameSessionConfig["regionId"] })
              }
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              {NOTE_GAME_CONFIG.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </fieldset>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-300">Notes</legend>
          <div className="flex gap-2">
            {(["naturals", "all"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => update({ accidentalMode: mode })}
                className={`rounded-md px-3 py-2 text-sm border ${
                  config.accidentalMode === mode
                    ? "border-sky-500 bg-sky-950/40 text-sky-200"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {mode === "naturals" ? "Naturals" : "All notes"}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-300">Fretboard</legend>
          <div className="flex gap-2">
            {([12, 21] as const).map((len) => (
              <button
                key={len}
                type="button"
                onClick={() => update({ fretboardLength: len })}
                className={`rounded-md px-3 py-2 text-sm border ${
                  config.fretboardLength === len
                    ? "border-sky-500 bg-sky-950/40 text-sky-200"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {len} frets
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-300">Difficulty</legend>
          <div className="flex flex-wrap gap-2">
            {NOTE_GAME_CONFIG.difficulties.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => update({ difficulty: d.id })}
                className={`rounded-md px-3 py-2 text-sm border ${
                  config.difficulty === d.id
                    ? "border-sky-500 bg-sky-950/40 text-sky-200"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-300">Duration</legend>
          <div className="flex flex-wrap gap-2">
            {NOTE_GAME_CONFIG.durationsSec.map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => update({ durationSec: sec })}
                className={`rounded-md px-3 py-2 text-sm border ${
                  config.durationSec === sec
                    ? "border-sky-500 bg-sky-950/40 text-sky-200"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {durationLabel(sec)}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleStart}
          className="rounded-md bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          Start session
        </button>
        <button
          type="button"
          onClick={onViewHistory}
          className="rounded-md border border-zinc-700 px-5 py-2.5 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
        >
          View history
        </button>
        <button
          type="button"
          onClick={() => update(DEFAULT_NOTE_GAME_CONFIG)}
          className="rounded-md px-3 py-2.5 text-sm text-zinc-500 hover:text-zinc-300"
        >
          Reset defaults
        </button>
      </div>
    </div>
  );
}
