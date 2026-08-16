import type { NoteGameSessionConfig } from "./types";

const KEY = "mesician_note_game_config_v1";

export const DEFAULT_NOTE_GAME_CONFIG: NoteGameSessionConfig = {
  mode: "wide",
  difficulty: "medium",
  accidentalMode: "naturals",
  fretboardLength: 12,
  durationSec: 180,
  regionId: "middle",
};

export function getStoredNoteGameConfig(): NoteGameSessionConfig {
  if (typeof window === "undefined") return DEFAULT_NOTE_GAME_CONFIG;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_NOTE_GAME_CONFIG;
    const parsed = JSON.parse(raw) as Partial<NoteGameSessionConfig>;
    return { ...DEFAULT_NOTE_GAME_CONFIG, ...parsed };
  } catch {
    return DEFAULT_NOTE_GAME_CONFIG;
  }
}

export function setStoredNoteGameConfig(config: NoteGameSessionConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(config));
}
