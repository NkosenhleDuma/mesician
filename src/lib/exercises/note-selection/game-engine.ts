import { NOTE_GAME_CONFIG, getDifficulty } from "./config";
import { ChallengeGenerator } from "./challenge-generator";
import { matchDetectedNote } from "./note-matcher";
import { pitchClassFromMidi } from "./fretboard-model";
import {
  applyWrongNotePenalty,
  average,
  computeCorrectScore,
  computeScorePerMinute,
  computeSessionAccuracy,
  median,
} from "./score-engine";
import type {
  ChallengeResult,
  NoteGameSessionConfig,
  NoteGameSessionResult,
  NoteGameState,
  NoteOnEvent,
} from "./types";

function initialState(): NoteGameState {
  return {
    gameState: "idle",
    challengeState: "waiting",
    config: null,
    currentChallenge: null,
    score: 0,
    streak: 0,
    bestStreak: 0,
    wrongNotes: 0,
    sessionStartedAt: null,
    sessionRemainingMs: 0,
    challengeRemainingMs: 0,
    challengeResults: [],
    revealedPositions: [],
    lastDetectedPitchClass: null,
    detectorPaused: false,
    feedback: null,
  };
}

export class NoteGameEngine {
  private state: NoteGameState = initialState();

  private generator: ChallengeGenerator | null = null;

  private currentWrongAttempts = 0;

  private listeners = new Set<(state: NoteGameState) => void>();

  private sessionTimer: ReturnType<typeof setInterval> | null = null;

  private challengeTimer: ReturnType<typeof setInterval> | null = null;

  private revealTimer: ReturnType<typeof setTimeout> | null = null;

  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  private lastHandledDetection: { pitchMidi: number; timestamp: number } | null = null;

  private sessionEndedAt: number | null = null;

  subscribe(handler: (state: NoteGameState) => void): () => void {
    this.listeners.add(handler);
    handler(this.getState());
    return () => this.listeners.delete(handler);
  }

  getState(): NoteGameState {
    return { ...this.state, challengeResults: [...this.state.challengeResults] };
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const l of this.listeners) l(snapshot);
  }

  private setState(partial: Partial<NoteGameState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  start(config: NoteGameSessionConfig): void {
    this.stopTimers();
    this.lastHandledDetection = null;
    this.currentWrongAttempts = 0;
    this.sessionEndedAt = null;

    this.generator = new ChallengeGenerator(config);
    const now = Date.now();

    this.state = {
      ...initialState(),
      gameState: "starting",
      config,
      sessionStartedAt: now,
      sessionRemainingMs: config.durationSec * 1000,
    };
    this.emit();

    this.setState({ gameState: "active" });
    this.startSessionTimer();
    this.beginNextChallenge();
  }

  stop(): NoteGameSessionResult | null {
    this.stopTimers();
    if (!this.state.config || !this.state.sessionStartedAt) return null;

    const endedAt = this.sessionEndedAt ?? Date.now();
    const startedAt = this.state.sessionStartedAt;
    const config = this.state.config;

    const correctResults = this.state.challengeResults.filter((r) => r.result === "correct");
    const responseTimes = correctResults
      .map((r) => r.responseTimeMs)
      .filter((t): t is number => t != null);

    const result: NoteGameSessionResult = {
      id: crypto.randomUUID(),
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      config,
      score: this.state.score,
      challengesPresented: this.state.challengeResults.length,
      correct: correctResults.length,
      timeouts: this.state.challengeResults.filter((r) => r.result === "timeout").length,
      wrongNotes: this.state.wrongNotes,
      accuracy: computeSessionAccuracy(this.state.challengeResults),
      avgResponseTimeMs: average(responseTimes),
      medianResponseTimeMs: median(responseTimes),
      bestStreak: this.state.bestStreak,
      scorePerMinute: computeScorePerMinute(this.state.score, config.durationSec),
      challengeResults: [...this.state.challengeResults],
    };

    this.setState({ gameState: "finished" });
    return result;
  }

  pauseDetector(): void {
    this.setState({ detectorPaused: true });
  }

  resumeDetector(): void {
    this.setState({ detectorPaused: false });
  }

  handleDetectedNote(event: NoteOnEvent): void {
    if (
      this.state.detectorPaused ||
      this.state.gameState !== "active" ||
      this.state.challengeState !== "waiting" ||
      !this.state.currentChallenge ||
      !this.state.config
    ) {
      return;
    }

    const now = event.timeMs;
    const pitchClass = pitchClassFromMidi(event.pitchMidi);
    this.setState({ lastDetectedPitchClass: pitchClass });

    const match = matchDetectedNote(
      this.state.currentChallenge,
      event.pitchMidi,
      this.lastHandledDetection,
      now,
      NOTE_GAME_CONFIG.duplicateInputGuardMs,
    );

    if (match.kind === "ignored") return;

    this.lastHandledDetection = { pitchMidi: match.pitchMidi, timestamp: now };

    if (match.kind === "incorrect") {
      this.handleIncorrect();
      return;
    }

    this.handleCorrect(now);
  }

  private handleIncorrect(): void {
    if (!this.state.config) return;

    const newScore = applyWrongNotePenalty(this.state.score, this.state.config.difficulty);
    this.currentWrongAttempts += 1;
    this.setState({
      score: newScore,
      streak: 0,
      wrongNotes: this.state.wrongNotes + 1,
      feedback: "incorrect",
    });

    this.clearFeedbackSoon();
  }

  private handleCorrect(nowMs: number): void {
    const challenge = this.state.currentChallenge;
    const config = this.state.config;
    if (!challenge || !config) return;

    this.stopChallengeTimer();

    const responseTimeMs = nowMs - challenge.startedAt;
    const streakBefore = this.state.streak;
    const streakAfter = streakBefore + 1;
    const awarded = computeCorrectScore(config.difficulty, responseTimeMs, streakAfter);
    const newScore = this.state.score + awarded;
    const bestStreak = Math.max(this.state.bestStreak, streakAfter);

    const result: ChallengeResult = {
      challengeId: challenge.id,
      targetPitchClass: challenge.targetPitchClass,
      targetDisplayName: challenge.displayName,
      mode: challenge.mode,
      selectedString: challenge.string,
      regionId: challenge.regionId,
      startedAt: challenge.startedAt,
      completedAt: nowMs,
      responseTimeMs,
      wrongAttempts: this.currentWrongAttempts,
      result: "correct",
      scoreAwarded: awarded,
      streakBefore,
      streakAfter,
    };

    this.setState({
      challengeState: "correct",
      score: newScore,
      streak: streakAfter,
      bestStreak,
      challengeResults: [...this.state.challengeResults, result],
      revealedPositions: challenge.validPositions,
      feedback: "correct",
    });

    this.scheduleNextChallenge(400);
  }

  private handleTimeout(): void {
    const challenge = this.state.currentChallenge;
    const config = this.state.config;
    if (!challenge || !config || this.state.challengeState !== "waiting") return;

    this.stopChallengeTimer();

    const nowMs = Date.now();
    const streakBefore = this.state.streak;

    const result: ChallengeResult = {
      challengeId: challenge.id,
      targetPitchClass: challenge.targetPitchClass,
      targetDisplayName: challenge.displayName,
      mode: challenge.mode,
      selectedString: challenge.string,
      regionId: challenge.regionId,
      startedAt: challenge.startedAt,
      completedAt: nowMs,
      wrongAttempts: this.currentWrongAttempts,
      result: "timeout",
      scoreAwarded: 0,
      streakBefore,
      streakAfter: 0,
    };

    const revealDurationMs = config.revealDurationMs ?? NOTE_GAME_CONFIG.revealDurationMs;

    this.setState({
      gameState: "revealing",
      challengeState: "timeout",
      streak: 0,
      challengeResults: [...this.state.challengeResults, result],
      revealedPositions: challenge.validPositions,
      feedback: "timeout",
    });

    this.revealTimer = setTimeout(() => {
      if (this.state.sessionRemainingMs <= 0) {
        this.finishSession();
        return;
      }
      this.setState({ gameState: "active" });
      this.beginNextChallenge();
    }, revealDurationMs);
  }

  private beginNextChallenge(): void {
    if (!this.generator || !this.state.config) return;

    if (this.state.sessionRemainingMs <= 0) {
      this.finishSession();
      return;
    }

    const challenge = this.generator.generate();
    if (!challenge) {
      this.finishSession();
      return;
    }

    challenge.startedAt = Date.now();
    this.lastHandledDetection = null;
    this.currentWrongAttempts = 0;

    const answerWindowMs = getDifficulty(this.state.config.difficulty).answerWindowMs;

    this.setState({
      currentChallenge: challenge,
      challengeState: "waiting",
      challengeRemainingMs: answerWindowMs,
      revealedPositions: [],
      feedback: null,
    });

    this.startChallengeTimer(answerWindowMs);
  }

  private scheduleNextChallenge(delayMs: number): void {
    this.revealTimer = setTimeout(() => {
      if (this.state.sessionRemainingMs <= 0) {
        this.finishSession();
        return;
      }
      this.beginNextChallenge();
    }, delayMs);
  }

  private finishSession(): void {
    this.stopTimers();
    this.sessionEndedAt = Date.now();
    this.setState({ gameState: "finished", currentChallenge: null });
  }

  private startSessionTimer(): void {
    this.sessionTimer = setInterval(() => {
      if (!this.state.sessionStartedAt || !this.state.config) return;

      const elapsed = Date.now() - this.state.sessionStartedAt;
      const remaining = this.state.config.durationSec * 1000 - elapsed;

      if (remaining <= 0) {
        this.setState({ sessionRemainingMs: 0 });
        if (this.state.challengeState === "waiting" && this.state.currentChallenge) {
          this.recordIncompleteChallenge();
        }
        this.finishSession();
        return;
      }

      this.setState({ sessionRemainingMs: remaining });
    }, 100);
  }

  private recordIncompleteChallenge(): void {
    const challenge = this.state.currentChallenge;
    if (!challenge) return;

    const result: ChallengeResult = {
      challengeId: challenge.id,
      targetPitchClass: challenge.targetPitchClass,
      targetDisplayName: challenge.displayName,
      mode: challenge.mode,
      selectedString: challenge.string,
      regionId: challenge.regionId,
      startedAt: challenge.startedAt,
      completedAt: Date.now(),
      result: "incomplete",
      wrongAttempts: 0,
      scoreAwarded: 0,
      streakBefore: this.state.streak,
      streakAfter: this.state.streak,
    };

    this.setState({
      challengeResults: [...this.state.challengeResults, result],
    });
  }

  private startChallengeTimer(answerWindowMs: number): void {
    this.stopChallengeTimer();
    const started = Date.now();

    this.challengeTimer = setInterval(() => {
      const elapsed = Date.now() - started;
      const remaining = answerWindowMs - elapsed;
      if (remaining <= 0) {
        this.setState({ challengeRemainingMs: 0 });
        this.handleTimeout();
        return;
      }
      this.setState({ challengeRemainingMs: remaining });
    }, 50);
  }

  private clearFeedbackSoon(): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => {
      if (this.state.feedback === "incorrect") {
        this.setState({ feedback: null });
      }
    }, 300);
  }

  private stopChallengeTimer(): void {
    if (this.challengeTimer) clearInterval(this.challengeTimer);
    this.challengeTimer = null;
  }

  private stopTimers(): void {
    if (this.sessionTimer) clearInterval(this.sessionTimer);
    if (this.challengeTimer) clearInterval(this.challengeTimer);
    if (this.revealTimer) clearTimeout(this.revealTimer);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.sessionTimer = null;
    this.challengeTimer = null;
    this.revealTimer = null;
    this.feedbackTimer = null;
  }

  dispose(): void {
    this.stopTimers();
    this.listeners.clear();
  }
}
