"use client";

import dynamic from "next/dynamic";
import { getDifficulty, getRegion } from "@/lib/exercises/note-selection/config";
import { modeLabel } from "@/lib/exercises/note-selection/challenge-generator";
import type { NoteGameState } from "@/lib/exercises/note-selection/types";
import { ChallengeDisplay } from "./ChallengeDisplay";
import { GameHUD } from "./GameHUD";

const FretboardCanvas = dynamic(
  () => import("./FretboardCanvas").then((m) => m.FretboardCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-48 sm:h-56 rounded-lg border border-zinc-800 bg-zinc-950/60" />
    ),
  },
);

export type NoteGamePlayProps = {
  state: NoteGameState;
  onStop: () => void;
};

export function NoteGamePlay({ state, onStop }: NoteGamePlayProps) {
  const challenge = state.currentChallenge;
  const config = state.config;
  if (!config) return null;

  const regionName =
    config.mode === "region" && config.regionId
      ? getRegion(config.regionId).name
      : undefined;

  const difficultyLabel = getDifficulty(config.difficulty).label;
  const showReveal =
    state.feedback === "timeout" ||
    state.feedback === "correct" ||
    state.gameState === "revealing";

  return (
    <div className="space-y-6">
      <GameHUD
        score={state.score}
        streak={state.streak}
        sessionRemainingMs={state.sessionRemainingMs}
      />

      {challenge && (
        <ChallengeDisplay
          displayName={challenge.displayName}
          modeLabel={modeLabel(challenge.mode)}
          stringNumber={challenge.string}
          regionName={regionName}
          challengeRemainingMs={state.challengeRemainingMs}
          difficulty={config.difficulty}
          feedback={state.feedback}
        />
      )}

      <FretboardCanvas
        fretboardLength={config.fretboardLength}
        mode={config.mode}
        highlightString={challenge?.string}
        regionId={config.regionId}
        revealedPositions={state.revealedPositions}
        showReveal={showReveal}
      />

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          {difficultyLabel} · {modeLabel(config.mode)} ·{" "}
          {config.accidentalMode === "naturals" ? "Naturals" : "All notes"}
        </span>
        <button
          type="button"
          onClick={onStop}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:border-zinc-500 hover:text-white"
        >
          End session
        </button>
      </div>

      {state.detectorPaused && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
          Detector paused — session timers are frozen.
        </div>
      )}
    </div>
  );
}
