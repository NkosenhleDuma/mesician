"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioCaptureWorklet } from "@/lib/audio/audio-capture-worklet";
import {
  detectPitchFromPcm,
  InTuneTracker,
  PitchSmoother,
} from "@/lib/tuner/continuous-pitch";
import {
  getStringMidi,
  TUNING_PRESETS,
  type TuningPreset,
} from "@/lib/tuner/tuning-presets";
import { TunerGauge } from "./TunerGauge";
import { StringProgress } from "./StringProgress";
import { TuningSelector } from "./TuningSelector";

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
};

const PCM_SAMPLES = 2048;
const POLL_INTERVAL_MS = 50;
const STALE_PITCH_MS = 500;
const PREAMP_GAIN = 3.0;

type TunerState = "idle" | "starting" | "tuning" | "complete";

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

export function TunerClient() {
  const [tuning, setTuning] = useState<TuningPreset>(TUNING_PRESETS[0]!);
  const [state, setState] = useState<TunerState>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [currentStringIndex, setCurrentStringIndex] = useState(0);
  const [completedStrings, setCompletedStrings] = useState<Set<number>>(new Set());
  const [cents, setCents] = useState<number | null>(null);
  const [inTuneProgress, setInTuneProgress] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const captureRef = useRef<AudioCaptureWorklet | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const smootherRef = useRef<PitchSmoother>(new PitchSmoother(5));
  const trackerRef = useRef<InTuneTracker>(new InTuneTracker(5, 1000));
  const lastValidPitchTimeRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    captureRef.current?.disconnect();
    captureRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const resetProgress = useCallback(() => {
    setCurrentStringIndex(0);
    setCompletedStrings(new Set());
    setCents(null);
    setInTuneProgress(0);
    smootherRef.current.reset();
    trackerRef.current.reset();
    lastValidPitchTimeRef.current = null;
  }, []);

  const handleTuningChange = useCallback(
    (preset: TuningPreset) => {
      setTuning(preset);
      if (state === "tuning" || state === "complete") {
        resetProgress();
        setState("tuning");
      }
    },
    [state, resetProgress],
  );

  const advanceToNextString = useCallback(() => {
    setCompletedStrings((prev) => new Set(prev).add(currentStringIndex));
    smootherRef.current.reset();
    trackerRef.current.reset();
    lastValidPitchTimeRef.current = null;
    setCents(null);
    setInTuneProgress(0);

    const nextIndex = currentStringIndex + 1;
    if (nextIndex >= tuning.strings.length) {
      setState("complete");
    } else {
      setCurrentStringIndex(nextIndex);
    }
  }, [currentStringIndex, tuning.strings.length]);

  const pollPitch = useCallback(async () => {
    const capture = captureRef.current;
    if (!capture) return;

    const clearIfStale = () => {
      const lastValid = lastValidPitchTimeRef.current;
      if (lastValid === null) return;
      if (performance.now() - lastValid > STALE_PITCH_MS) {
        setCents(null);
        trackerRef.current.reset();
        setInTuneProgress(0);
        lastValidPitchTimeRef.current = null;
      }
    };

    try {
      const { pcm, sampleRate } = await capture.requestPcmTail(PCM_SAMPLES, 500);
      const targetMidi = getStringMidi(tuning, currentStringIndex);
      if (targetMidi === null) return;

      const result = detectPitchFromPcm(pcm, sampleRate, targetMidi);

      if (result && result.confidence > 0.5) {
        lastValidPitchTimeRef.current = performance.now();
        const smoothedCents = smootherRef.current.push(result.cents);
        setCents(smoothedCents);

        const confirmed = trackerRef.current.update(smoothedCents);
        setInTuneProgress(trackerRef.current.getProgress());

        if (confirmed) {
          advanceToNextString();
        }
      } else {
        clearIfStale();
      }
    } catch {
      clearIfStale();
    }
  }, [tuning, currentStringIndex, advanceToNextString]);

  useEffect(() => {
    if (state !== "tuning") return;

    pollIntervalRef.current = window.setInterval(() => {
      void pollPitch();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [state, pollPitch]);

  const startTuning = useCallback(async () => {
    setState("starting");
    setMicError(null);
    resetProgress();

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      } catch (err) {
        if (
          err &&
          typeof err === "object" &&
          "name" in err &&
          (err as { name: string }).name === "OverconstrainedError"
        ) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw err;
        }
      }
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      await ctx.resume();

      const capture = new AudioCaptureWorklet(ctx);
      await capture.connect(stream, { gain: PREAMP_GAIN });
      captureRef.current = capture;

      setState("tuning");
    } catch (err) {
      setMicError(describeMicError(err));
      setState("idle");
    }
  }, [resetProgress]);

  const stopTuning = useCallback(() => {
    cleanup();
    setState("idle");
    resetProgress();
  }, [cleanup, resetProgress]);

  const restartTuning = useCallback(() => {
    resetProgress();
    setState("tuning");
  }, [resetProgress]);

  const currentNote = tuning.strings[currentStringIndex] ?? "";
  const noteNameDisplay = currentNote.replace(/\d+$/, "");

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-zinc-400 hover:text-white transition"
              aria-label="Back to home"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-semibold">Guitar Tuner</h1>
          </div>
          <TuningSelector
            value={tuning}
            onChange={handleTuningChange}
            disabled={state === "starting"}
          />
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-8">
        {state === "idle" && (
          <div className="text-center space-y-6">
            <p className="text-zinc-400 max-w-sm">
              Tune your guitar string by string, starting from low E. The tuner
              will automatically advance when each string is in tune.
            </p>
            <button
              type="button"
              onClick={() => void startTuning()}
              className="px-8 py-4 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition touch-manipulation"
            >
              Start Tuning
            </button>
            {micError && (
              <p className="text-amber-400 text-sm">{micError}</p>
            )}
          </div>
        )}

        {state === "starting" && (
          <div className="text-center space-y-4">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-zinc-400">Starting microphone...</p>
          </div>
        )}

        {state === "tuning" && (
          <>
            <StringProgress
              tuning={tuning}
              currentStringIndex={currentStringIndex}
              completedStrings={completedStrings}
            />

            <div className="w-full max-w-sm">
              <TunerGauge
                cents={cents}
                noteName={noteNameDisplay}
                inTuneProgress={inTuneProgress}
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={advanceToNextString}
                className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm font-medium hover:bg-zinc-700 transition touch-manipulation"
              >
                Skip String
              </button>
              <button
                type="button"
                onClick={stopTuning}
                className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-400 text-sm font-medium hover:bg-zinc-900 transition touch-manipulation"
              >
                Stop
              </button>
            </div>
          </>
        )}

        {state === "complete" && (
          <div className="text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-emerald-600 flex items-center justify-center mx-auto">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-semibold">All Tuned!</h2>
              <p className="text-zinc-400 mt-2">
                All 6 strings are in tune. Ready to play.
              </p>
            </div>
            <button
              type="button"
              onClick={restartTuning}
              className="px-6 py-3 rounded-xl bg-zinc-800 text-white font-medium hover:bg-zinc-700 transition touch-manipulation"
            >
              Tune Again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
