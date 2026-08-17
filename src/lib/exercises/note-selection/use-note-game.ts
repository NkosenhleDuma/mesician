"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioCaptureWorklet,
  DEFAULT_PREAMP_GAIN,
} from "@/lib/audio/audio-capture-worklet";
import { BasicPitchDetector } from "@/lib/detection/basic-pitch-detector";
import { NoteGameEngine } from "./game-engine";
import { NoteOnTracker } from "./note-on-tracker";
import type { NoteGameSessionConfig, NoteGameSessionResult, NoteGameState } from "./types";

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
};

const POLL_MS = 50;

function describeMicError(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Mic blocked: open this page over HTTPS or via localhost.";
  }
  const name =
    err && typeof err === "object" && "name" in err
      ? (err as { name: unknown }).name
      : null;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Mic permission denied.";
  }
  if (name === "NotFoundError") {
    return "No microphone found.";
  }
  return "Mic unavailable.";
}

export function useNoteGame() {
  const [state, setState] = useState<NoteGameState>(() => ({
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
  }));

  const [micError, setMicError] = useState<string | null>(null);
  const [detectorReady, setDetectorReady] = useState(false);

  const engineRef = useRef<NoteGameEngine | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const captureRef = useRef<AudioCaptureWorklet | null>(null);
  const detectorRef = useRef<BasicPitchDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pollRef = useRef<number | null>(null);
  const noteOnTrackerRef = useRef(new NoteOnTracker());
  const lastResultRef = useRef<NoteGameSessionResult | null>(null);

  const cleanupAudio = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    detectorRef.current?.stop();
    captureRef.current?.disconnect();
    captureRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    detectorRef.current = null;
    setDetectorReady(false);
  }, []);

  useEffect(() => {
    const engine = new NoteGameEngine();
    engineRef.current = engine;
    const unsub = engine.subscribe(setState);
    return () => {
      unsub();
      engine.dispose();
      cleanupAudio();
    };
  }, [cleanupAudio]);

  const startPolling = useCallback(() => {
    if (pollRef.current != null) return;

    pollRef.current = window.setInterval(() => {
      const engine = engineRef.current;
      const detector = detectorRef.current;
      if (!engine || !detector?.started) return;

      const nowMs = Date.now();
      const active = detector.snapshotActiveNotes();
      const events = noteOnTrackerRef.current.poll(active, nowMs);
      for (const ev of events) {
        engine.handleDetectedNote(ev);
      }
    }, POLL_MS);
  }, []);

  const initDetector = useCallback(async () => {
    if (detectorRef.current?.started) return true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      await ctx.resume().catch(() => {});

      const capture = new AudioCaptureWorklet(ctx);
      await capture.connect(stream, { gain: DEFAULT_PREAMP_GAIN });
      captureRef.current = capture;

      const detector = new BasicPitchDetector(ctx);
      detector.attachCapture(capture);
      await detector.init();
      detector.start();
      detectorRef.current = detector;

      noteOnTrackerRef.current.reset();
      setMicError(null);
      setDetectorReady(true);
      startPolling();
      return true;
    } catch (err) {
      console.error("[NoteGame] Mic init failed:", err);
      setMicError(describeMicError(err));
      cleanupAudio();
      return false;
    }
  }, [cleanupAudio, startPolling]);

  const startSession = useCallback(
    async (config: NoteGameSessionConfig) => {
      const ok = await initDetector();
      if (!ok) return null;

      engineRef.current?.start(config);
      return engineRef.current;
    },
    [initDetector],
  );

  const stopSession = useCallback((): NoteGameSessionResult | null => {
    cleanupAudio();
    const result = engineRef.current?.stop() ?? null;
    lastResultRef.current = result;
    return result;
  }, [cleanupAudio]);

  const pauseDetector = useCallback(() => {
    engineRef.current?.pauseDetector();
    detectorRef.current?.stop();
  }, []);

  const resumeDetector = useCallback(async () => {
    if (!detectorRef.current) {
      await initDetector();
    } else if (!detectorRef.current.started) {
      detectorRef.current.start();
      startPolling();
    }
    engineRef.current?.resumeDetector();
  }, [initDetector, startPolling]);

  return {
    state,
    micError,
    detectorReady,
    lastResult: lastResultRef.current,
    startSession,
    stopSession,
    pauseDetector,
    resumeDetector,
    initDetector,
  };
}
