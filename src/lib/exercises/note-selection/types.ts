export type GameMode = "single-string" | "region" | "wide";

export type DifficultyId = "beginner" | "easy" | "medium" | "hard" | "expert";

export type AccidentalMode = "naturals" | "all";

export type FretboardLength = 12 | 21;

export type SessionDurationSec = 60 | 180 | 300 | 600;

export type FretboardRegionId =
  | "lower-open"
  | "low-mid"
  | "middle"
  | "upper-mid"
  | "treble-strings"
  | "bass-strings";

export type FretboardRegion = {
  id: FretboardRegionId;
  name: string;
  minString: number;
  maxString: number;
  minFret: number;
  maxFret: number;
};

export type DifficultyPreset = {
  id: DifficultyId;
  label: string;
  answerWindowMs: number;
  scoreMultiplier: number;
};

export type FretPosition = {
  string: number;
  fret: number;
  midiPitch: number;
  pitchClass: number;
};

export type NoteGameSessionConfig = {
  mode: GameMode;
  difficulty: DifficultyId;
  accidentalMode: AccidentalMode;
  fretboardLength: FretboardLength;
  durationSec: SessionDurationSec;
  regionId?: FretboardRegionId;
  revealDurationMs?: number;
};

export type NoteChallenge = {
  id: string;
  targetPitchClass: number;
  displayName: string;
  mode: GameMode;
  string?: number;
  regionId?: string;
  validPositions: FretPosition[];
  startedAt: number;
};

export type ChallengeResult = {
  challengeId: string;
  targetPitchClass: number;
  targetDisplayName: string;
  mode: GameMode;
  selectedString?: number;
  regionId?: string;
  startedAt: number;
  completedAt: number;
  responseTimeMs?: number;
  wrongAttempts: number;
  result: "correct" | "timeout" | "incomplete";
  scoreAwarded: number;
  streakBefore: number;
  streakAfter: number;
};

export type NoteGameSessionResult = {
  id: string;
  startedAt: string;
  endedAt: string;
  config: NoteGameSessionConfig;
  score: number;
  challengesPresented: number;
  correct: number;
  timeouts: number;
  wrongNotes: number;
  accuracy: number;
  avgResponseTimeMs: number | null;
  medianResponseTimeMs: number | null;
  bestStreak: number;
  scorePerMinute: number;
  challengeResults: ChallengeResult[];
};

export type GameState = "idle" | "starting" | "active" | "revealing" | "paused" | "finished";

export type ChallengeState = "waiting" | "correct" | "timeout";

export type NoteOnEvent = {
  pitchMidi: number;
  timeMs: number;
  velocity: number;
};

export type NoteGameState = {
  gameState: GameState;
  challengeState: ChallengeState;
  config: NoteGameSessionConfig | null;
  currentChallenge: NoteChallenge | null;
  score: number;
  streak: number;
  bestStreak: number;
  wrongNotes: number;
  sessionStartedAt: number | null;
  sessionRemainingMs: number;
  challengeRemainingMs: number;
  challengeResults: ChallengeResult[];
  revealedPositions: FretPosition[];
  lastDetectedPitchClass: number | null;
  detectorPaused: boolean;
  feedback: "correct" | "incorrect" | "timeout" | null;
};
