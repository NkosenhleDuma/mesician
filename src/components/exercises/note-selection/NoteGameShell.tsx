"use client";

import { useCallback, useEffect, useState } from "react";
import type { NoteGameSessionConfig, NoteGameSessionResult } from "@/lib/exercises/note-selection/types";
import { useNoteGame } from "@/lib/exercises/note-selection/use-note-game";
import type { HistorySession } from "./NoteGameHistory";
import { NoteGameHistory } from "./NoteGameHistory";
import { NoteGamePlay } from "./NoteGamePlay";
import { NoteGameResults } from "./NoteGameResults";
import { NoteGameSetup } from "./NoteGameSetup";

type Screen = "setup" | "play" | "results" | "history";

async function persistSession(result: NoteGameSessionResult): Promise<void> {
  await fetch("/api/exercises/note-selection/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result }),
  });
}

async function fetchHistory(): Promise<HistorySession[]> {
  const res = await fetch("/api/exercises/note-selection/sessions");
  if (!res.ok) return [];
  const data = (await res.json()) as { sessions: HistorySession[] };
  return data.sessions ?? [];
}

export function NoteGameShell() {
  const { state, micError, startSession, stopSession, initDetector } = useNoteGame();
  const [screen, setScreen] = useState<Screen>("setup");
  const [lastResult, setLastResult] = useState<NoteGameSessionResult | null>(null);
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistory(await fetchHistory());
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (state.gameState === "finished" && screen === "play") {
      const result = stopSession();
      if (result) {
        setLastResult(result);
        setScreen("results");
        void persistSession(result);
      }
    }
  }, [state.gameState, screen, stopSession]);

  const handleStart = async (config: NoteGameSessionConfig) => {
    setLastResult(null);
    const engine = await startSession(config);
    if (engine) setScreen("play");
  };

  const handleStop = () => {
    const result = stopSession();
    if (result) {
      setLastResult(result);
      setScreen("results");
      void persistSession(result);
    } else {
      setScreen("setup");
    }
  };

  const handleViewHistory = () => {
    setScreen("history");
    void loadHistory();
  };

  if (screen === "play" && state.gameState !== "idle" && state.gameState !== "finished") {
    return <NoteGamePlay state={state} onStop={handleStop} />;
  }

  if (screen === "results" && lastResult) {
    return (
      <NoteGameResults
        result={lastResult}
        onPlayAgain={() => setScreen("setup")}
        onViewHistory={handleViewHistory}
      />
    );
  }

  if (screen === "history") {
    return (
      <NoteGameHistory
        sessions={history}
        loading={historyLoading}
        onBack={() => setScreen("setup")}
      />
    );
  }

  return (
    <NoteGameSetup
      onStart={handleStart}
      onViewHistory={handleViewHistory}
      micError={micError}
      onRequestMic={() => void initDetector()}
    />
  );
}
