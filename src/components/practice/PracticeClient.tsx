"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartEvent, ChartJson } from "@/lib/chart/types";
import { resolveGuitarInstrument } from "@/lib/audio/guitar-instrument";
import {
  createTransport,
  getSongTime,
  pause,
  play,
  seek,
  type TransportState,
} from "@/lib/audio/transport";
import {
  getStoredDebugCapture,
  getStoredDebugSessionRecord,
  getStoredEmulateDelayMs,
  getStoredEmulateJitterMs,
  getStoredLatencyMs,
  getStoredPlayAlongEnabled,
  getStoredPlayAlongSource,
  getStoredPlaybackVolume,
  getStoredPracticeMode,
  setStoredDebugCapture,
  setStoredDebugSessionRecord,
  setStoredPlayAlongEnabled,
  type PlayAlongSource,
  type PracticeMode,
} from "@/lib/calibration/storage";
import {
  applyVerdictToScore,
  classifyTiming,
  verdictKey,
  VERDICT_WINDOWS_MS,
  type Verdict,
} from "@/lib/scoring/engine";
import {
  DebugCapture,
  type BpTraceSnapshot,
  type DebugReportFlushReason,
  type ExpectedEventSnapshot,
  type MonoTraceSnapshot,
  type PolyTraceSnapshot,
} from "@/lib/scoring/debug-capture";
import {
  inferPlayedStringFret,
  scoreOnsetAgainstEvent,
  scoreBpOnsetAgainstEvent,
  classifyOnsetDebugOutcome,
  type MonoRecognizerTrace,
  type PolyRecognizerTrace,
  type ScoreOnsetAgainstEventResult,
} from "@/lib/scoring/recognize";
import { AudioCaptureWorklet, type OnsetPayload } from "@/lib/audio/audio-capture-worklet";
import { clampSpeed } from "./practice-constants";
import { HighwayCanvas, type TimingFlashPayload } from "./HighwayCanvas";
import { MobilePlayShell } from "./MobilePlayShell";
import { PracticeControls, type ScoreSnap, type WrongNoteFlash } from "./PracticeControls";
import { PracticeIntro } from "./PracticeIntro";
import type { DetectionMetricsSnapshot } from "@/lib/detection/pitch-detection-metrics";
import { BasicPitchDetector } from "@/lib/detection/basic-pitch-detector";
import { loadPitchDetectionConfig } from "@/config/pitchDetection.config";
import { useScreenWakeLock } from "@/lib/hooks/use-screen-wake-lock";

const EMULATE_LOOKAHEAD_SEC = 2;
const MOBILE_MAX_W_PX = 767;
/** Align with default RMS gate in `public/worklets/audio-capture-processor.js` */
const MIC_RMS_GATE_HINT = 0.014;
const WRONG_NOTE_FLASH_MS = 200;

function pickMediaRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return "audio/webm";
}

function livePlayAlongInput(src: PlayAlongSource): boolean {
  return src === "mic" || src === "file";
}

const MIC_UNAVAILABLE_MSG =
  "Mic unavailable. Check microphone permissions or use Emulate source.";

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
};

function getErrName(err: unknown): string | null {
  if (err && typeof err === "object" && "name" in err) {
    const n = (err as { name: unknown }).name;
    if (typeof n === "string") return n;
  }
  return null;
}

function describeMicError(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Mic blocked: open this page over HTTPS or via localhost.";
  }
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message: unknown }).message;
    if (msg === "no-media-devices") {
      return "Mic API not available in this browser. Try Safari/Chrome on this device.";
    }
  }
  const name = getErrName(err);
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Mic permission denied. Allow microphone access in browser settings.";
  }
  if (name === "NotFoundError") {
    return "No microphone found on this device.";
  }
  if (name === "NotReadableError") {
    return "Mic is in use by another app.";
  }
  if (name === "OverconstrainedError") {
    return "Mic settings unsupported on this device.";
  }
  return MIC_UNAVAILABLE_MSG;
}

type Counts = { perfect: number; slight: number; off: number; miss: number };

const emptyCounts = (): Counts => ({ perfect: 0, slight: 0, off: 0, miss: 0 });

function bumpCount(counts: Counts, verdict: Verdict): void {
  switch (verdict) {
    case "perfect":
      counts.perfect += 1;
      break;
    case "slightEarly":
    case "slightLate":
      counts.slight += 1;
      break;
    case "early":
    case "late":
      counts.off += 1;
      break;
    case "miss":
      counts.miss += 1;
      break;
  }
}

type Props = {
  chart: ChartJson;
  songId: string;
  trackId: string;
  songTitle: string;
  trackName: string;
};

type LastHit = {
  eventId: string;
  string: number;
  verdict: Verdict;
  timingErrorMs: number;
};

function eventHasPendingString(ev: ChartEvent, verdicts: Map<string, Verdict>): boolean {
  return ev.notes.some((n) => !verdicts.has(verdictKey(ev.id, n.string)));
}

/** Map mic onset AudioContext clock → musical song seconds while transport is playing. */
function audioCtxTimeToSongSec(tr: TransportState, audioCtxTimeSec: number): number {
  const rate = tr.playbackRate > 0 ? tr.playbackRate : 1;
  return tr.playSongStart + (audioCtxTimeSec - tr.playAudioStart) * rate;
}

function snapshotChartEvent(ev: ChartEvent): ExpectedEventSnapshot {
  return {
    id: ev.id,
    t0: ev.t0,
    kind: ev.kind,
    notes: ev.notes.map((n) => ({
      string: n.string,
      midi: n.midi,
      dead: n.dead ?? false,
    })),
  };
}

function buildTraceSnapshots(
  r: ScoreOnsetAgainstEventResult,
): MonoTraceSnapshot | PolyTraceSnapshot | BpTraceSnapshot | null {
  if (r.trace.kind === "bp") {
    const t = r.trace;
    return {
      kind: "bp",
      evidenceMidis: [...t.evidenceMidis],
      dominantMidi: t.dominantMidi,
    };
  }
  if (r.isPoly) {
    const t = r.trace as PolyRecognizerTrace;
    return {
      kind: "poly",
      detectedMidi: r.detectedMidi,
      detectedHz: r.detectedHz,
      normEnergy: t.normEnergy,
      supportThreshold: t.supportThreshold,
      perNote: t.perNote.map((p) => ({
        string: p.string,
        midi: p.midi,
        support: p.support,
        pitchOk: p.pitchOk,
      })),
    };
  }
  const m = r.trace as MonoRecognizerTrace;
  return {
    kind: "mono",
    yinHz: m.yinHz,
    cmndfMin: m.cmndfMin,
    detectedMidi: r.detectedMidi,
    detectedHz: r.detectedHz,
    centsPerNote: m.centsPerNote,
  };
}

function IconRestart({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-7.1" strokeLinecap="round" />
      <path d="M3 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPlay({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconPause({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

export function PracticeClient({ chart, songId, trackId, songTitle, trackName }: Props) {
  const router = useRouter();
  const transportRef = useRef<TransportState | null>(null);
  const verdictsRef = useRef<Map<string, Verdict>>(new Map());
  const emulateOffsetsRef = useRef<Map<string, number>>(new Map());
  const scoreStateRef = useRef({ total: 0, multiplier: 1, combo: 0 });
  const maxMultRef = useRef(1);
  const countsRef = useRef<Counts>(emptyCounts());
  const runStartedAtRef = useRef<number | null>(null);
  const savedRunRef = useRef(false);
  const practiceModeRef = useRef<PracticeMode>("practice");
  const micStreamRef = useRef<MediaStream | null>(null);
  const wrongFlashTimerRef = useRef<number>(0);

  const debugCaptureRef = useRef(new DebugCapture());
  const debugAudioSampleRateRef = useRef<number | null>(null);
  const debugMissLoggedRef = useRef<Set<string>>(new Set());
  const debugCaptureEnabledRef = useRef(false);
  const flushDebugToApiRef = useRef<
    (reason: DebugReportFlushReason) => Promise<{ ok: boolean; key?: string; error?: string }>
  >(() => Promise.resolve({ ok: false, error: "not-ready" }));
  /** For chart unmount / `pagehide` — wired to `flushDebugCaptureKeepalive` */
  const flushDebugKeepaliveRef = useRef<((reason: DebugReportFlushReason) => void) | null>(null);
  const basicPitchDetectorRef = useRef<BasicPitchDetector | null>(null);
  const pitchDiagRef = useRef<DetectionMetricsSnapshot | null>(null);
  const [tick, setTick] = useState(0);
  const [latencyMs, setLatencyMs] = useState(getStoredLatencyMs);
  const [playAlong, setPlayAlong] = useState(getStoredPlayAlongEnabled);
  const [source, setSource] = useState<PlayAlongSource>(getStoredPlayAlongSource);
  const [emulateDelayMs, setEmulateDelayMs] = useState(getStoredEmulateDelayMs);
  const [emulateJitterMs, setEmulateJitterMs] = useState(getStoredEmulateJitterMs);
  const [lastHit, setLastHit] = useState<LastHit | null>(null);
  const timingFlashRef = useRef<TimingFlashPayload | null>(null);
  const timingFlashStartedMsRef = useRef(0);
  const timingFlashKeyCounterRef = useRef(0);
  const [wrongNoteFlash, setWrongNoteFlash] = useState<WrongNoteFlash | null>(null);
  const [scoreSnap, setScoreSnap] = useState<ScoreSnap>({
    total: 0,
    multiplier: 1,
    combo: 0,
    maxMultiplier: 1,
    counts: emptyCounts(),
  });
  const [practiceMode, setPracticeMode] = useState<PracticeMode>(getStoredPracticeMode);
  const [bestScore, setBestScore] = useState(0);
  const [saveBusy, setSaveBusy] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playbackVolume, setPlaybackVolume] = useState(getStoredPlaybackVolume);
  const [audioBusy, setAudioBusy] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
  const [started, setStarted] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speedExpanded, setSpeedExpanded] = useState(false);
  const [showTapHint, setShowTapHint] = useState(false);
  const [playAlongError, setPlayAlongError] = useState<string | null>(null);
  const [debugCaptureEnabled, setDebugCaptureEnabled] = useState(getStoredDebugCapture);
  const [debugReportBusy, setDebugReportBusy] = useState(false);
  const [debugReportMsg, setDebugReportMsg] = useState<string | null>(null);
  const [debugUploadedKey, setDebugUploadedKey] = useState<string | null>(null);
  const debugSessionRecordRef = useRef(getStoredDebugSessionRecord());
  const [debugSessionRecord, setDebugSessionRecord] = useState(getStoredDebugSessionRecord);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const lastRecorderMimeRef = useRef("audio/webm");

  const fileInputAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileMediaElementSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const debugFileUrlRef = useRef<string | null>(null);
  const [debugInputFileName, setDebugInputFileName] = useState<string | null>(null);
  const playbackVolumeRef = useRef(playbackVolume);
  playbackVolumeRef.current = playbackVolume;
  const playAlongRef = useRef(playAlong);
  playAlongRef.current = playAlong;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  practiceModeRef.current = practiceMode;
  debugCaptureEnabledRef.current = debugCaptureEnabled;
  const forceTick = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    return () => {
      basicPitchDetectorRef.current?.dispose();
      basicPitchDetectorRef.current = null;
    };
  }, []);

  const syncScoreUi = useCallback(() => {
    const perform = practiceModeRef.current === "perform";
    setScoreSnap({
      total: perform ? scoreStateRef.current.total : 0,
      multiplier: perform ? scoreStateRef.current.multiplier : 1,
      combo: perform ? scoreStateRef.current.combo : 0,
      maxMultiplier: perform ? maxMultRef.current : 1,
      counts: { ...countsRef.current },
    });
  }, []);

  const applyVerdictForString = useCallback(
    (eventId: string, gpString: number, verdict: Verdict, timingErrorMs: number) => {
      const key = verdictKey(eventId, gpString);
      if (verdictsRef.current.has(key)) return false;
      verdictsRef.current.set(key, verdict);
      const perform = practiceModeRef.current === "perform";
      if (perform) {
        scoreStateRef.current = applyVerdictToScore(scoreStateRef.current, verdict);
        maxMultRef.current = Math.max(maxMultRef.current, scoreStateRef.current.multiplier);
      }
      bumpCount(countsRef.current, verdict);
      setLastHit({ eventId, string: gpString, verdict, timingErrorMs });
      if (verdict === "miss") {
        timingFlashRef.current = null;
        timingFlashStartedMsRef.current = 0;
      } else {
        timingFlashKeyCounterRef.current += 1;
        timingFlashStartedMsRef.current = performance.now();
        timingFlashRef.current = {
          key: timingFlashKeyCounterRef.current,
          eventId,
          verdict,
        };
      }
      syncScoreUi();
      forceTick();
      return true;
    },
    [syncScoreUi, forceTick],
  );

  /** Clears verdicts and mic debug buffer. Restart / seek-back / source switch discard capture without uploading. */
  const clearPlayAlongState = useCallback(
    (resetLastHit = true) => {
      verdictsRef.current.clear();
      emulateOffsetsRef.current.clear();
      setWrongNoteFlash(null);
      window.clearTimeout(wrongFlashTimerRef.current);
      const rec = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      recordChunksRef.current = [];
      debugCaptureRef.current.clear();
      debugMissLoggedRef.current.clear();
      scoreStateRef.current = { total: 0, multiplier: 1, combo: 0 };
      maxMultRef.current = 1;
      countsRef.current = emptyCounts();
      runStartedAtRef.current = null;
      savedRunRef.current = false;
      if (resetLastHit) {
        setLastHit(null);
        timingFlashRef.current = null;
        timingFlashStartedMsRef.current = 0;
      }
      syncScoreUi();
      forceTick();
    },
    [forceTick, syncScoreUi],
  );

  const stopMicStream = useCallback(() => {
    const s = micStreamRef.current;
    if (!s) return;
    s.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, []);

  const requestMicStream = useCallback(async (): Promise<MediaStream> => {
    const existing = micStreamRef.current;
    if (existing && existing.getAudioTracks().some((t) => t.readyState === "live")) {
      return existing;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      const err = new Error("insecure-context");
      throw err;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("no-media-devices");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch (err) {
      if (getErrName(err) === "OverconstrainedError") {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        throw err;
      }
    }
    stopMicStream();
    micStreamRef.current = stream;
    return stream;
  }, [stopMicStream]);

  /** UI-gesture entry point: returns true on success, false on failure (sets error). */
  const acquireMic = useCallback(async (): Promise<boolean> => {
    const tr = transportRef.current;
    const resumeP =
      tr && tr.ctx.state === "suspended"
        ? tr.ctx.resume().catch(() => undefined)
        : Promise.resolve();
    try {
      await requestMicStream();
      await resumeP;
      setPlayAlongError(null);
      return true;
    } catch (err) {
      setPlayAlongError(describeMicError(err));
      return false;
    }
  }, [requestMicStream]);

  const stopSessionRecordingSegment = useCallback(async () => {
    const rec = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (!rec || rec.state === "inactive") return;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
  }, []);

  const startSessionRecording = useCallback((stream: MediaStream) => {
    if (!debugSessionRecordRef.current || sourceRef.current !== "mic") return;
    if (mediaRecorderRef.current?.state === "recording") return;
    if (!stream.getAudioTracks().length) return;
    const mime = pickMediaRecorderMime();
    lastRecorderMimeRef.current = mime || "audio/webm";
    try {
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      rec.start(400);
      mediaRecorderRef.current = rec;
    } catch {
      mediaRecorderRef.current = null;
    }
  }, []);

  const persistDebugSessionRecord = useCallback((enabled: boolean) => {
    setDebugSessionRecord(enabled);
    setStoredDebugSessionRecord(enabled);
    debugSessionRecordRef.current = enabled;
  }, []);

  const onDebugFileChange = useCallback((file: File | null) => {
    if (debugFileUrlRef.current) {
      URL.revokeObjectURL(debugFileUrlRef.current);
      debugFileUrlRef.current = null;
    }
    const el = fileInputAudioRef.current;
    if (!file) {
      setDebugInputFileName(null);
      if (el) {
        el.pause();
        el.removeAttribute("src");
      }
      return;
    }
    const url = URL.createObjectURL(file);
    debugFileUrlRef.current = url;
    setDebugInputFileName(file.name);
    if (el) {
      el.pause();
      el.src = url;
      void el.load();
    }
  }, []);

  const commitPlaybackRate = useCallback(
    (r: number) => {
      const next = clampSpeed(r);
      setPlaybackRate(next);
      const tr = transportRef.current;
      if (!tr) return;
      tr.playbackRate = next;
      if (tr.playing) {
        setAudioBusy(true);
        void play(tr).finally(() => {
          setAudioBusy(false);
          forceTick();
        });
      } else forceTick();
    },
    [forceTick],
  );

  const restart = useCallback(() => {
    const tr = transportRef.current;
    if (tr) {
      pause(tr);
      seek(tr, 0);
    }
    clearPlayAlongState();
    forceTick();
  }, [clearPlayAlongState, forceTick]);

  const exitToLibrary = useCallback(() => {
    const tr = transportRef.current;
    if (tr?.playing) {
      pause(tr);
      forceTick();
    }
    router.push("/library");
  }, [forceTick, router]);

  const onPlayPause = useCallback(() => {
    const tr = transportRef.current;
    if (!tr || audioBusy) return;
    if (tr.playing) {
      if (
        playAlongRef.current &&
        debugCaptureEnabledRef.current &&
        livePlayAlongInput(sourceRef.current) &&
        debugCaptureRef.current.length > 0
      ) {
        const flushDbg = flushDebugToApiRef.current;
        void flushDbg("pause").then((d) => {
          if (d.ok) setDebugReportMsg(d.key ? `Debug (pause): ${d.key}` : "Debug uploaded (pause)");
          forceTick();
        });
      }
      pause(tr);
      if (sourceRef.current === "mic") {
        void stopSessionRecordingSegment();
      }
      forceTick();
      return;
    }
    setAudioBusy(true);
    const beatsPerBar = chart.meta.timeSig[0]?.num ?? 4;
    void play(tr, { countInBeats: beatsPerBar })
      .then(() => {
        if (
          playAlongRef.current &&
          livePlayAlongInput(sourceRef.current) &&
          practiceModeRef.current === "perform"
        ) {
          runStartedAtRef.current = Date.now();
        }
        if (sourceRef.current === "mic") {
          const s = micStreamRef.current;
          if (s) startSessionRecording(s);
        }
      })
      .finally(() => {
        setAudioBusy(false);
        forceTick();
      });
  }, [audioBusy, chart, forceTick, startSessionRecording, stopSessionRecordingSegment]);

  const onSeek = useCallback(
    (t: number, currentTime: number) => {
      if (t < currentTime) clearPlayAlongState();
      const tr = transportRef.current;
      if (tr) seek(tr, t);
      if (sourceRef.current === "file") {
        const el = fileInputAudioRef.current;
        if (el) el.currentTime = Math.max(0, t);
      }
      forceTick();
    },
    [clearPlayAlongState, forceTick],
  );

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/songs/${songId}/tracks/${trackId}/runs`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { bestScore?: number }) => {
        if (!cancelled && typeof d.bestScore === "number") setBestScore(d.bestScore);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [songId, trackId]);

  useEffect(() => {
    clearPlayAlongState();
    const t = createTransport(chart, { playbackVolume: playbackVolumeRef.current });
    transportRef.current = t;
    t.playbackRate = 1;
    setPlaybackRate(1);
    void resolveGuitarInstrument(t);
    return () => {
      flushDebugKeepaliveRef.current?.("exit");
      fileMediaElementSourceRef.current = null;
      t.guitar?.disconnect();
      void t.ctx.close();
      transportRef.current = null;
    };
  }, [chart, clearPlayAlongState]);

  useEffect(() => {
    const onPageHide = () => {
      flushDebugKeepaliveRef.current?.("exit");
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 33);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_W_PX}px)`);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const sync = () => setPortrait(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    syncScoreUi();
  }, [practiceMode, syncScoreUi]);

  useEffect(() => {
    if (practiceMode !== "perform") return;
    const next = clampSpeed(1);
    setPlaybackRate(next);
    const tr = transportRef.current;
    if (tr) {
      tr.playbackRate = next;
      if (tr.playing) {
        setAudioBusy(true);
        void play(tr).finally(() => {
          setAudioBusy(false);
          forceTick();
        });
      } else forceTick();
    }
    if (!playAlongRef.current) {
      setPlayAlong(true);
      setStoredPlayAlongEnabled(true);
      clearPlayAlongState();
    }
  }, [practiceMode, forceTick, clearPlayAlongState]);

  useEffect(() => {
    if (!isMobile || !started) return;
    if (!portrait) return;
    const tr = transportRef.current;
    if (tr?.playing) pause(tr);
    forceTick();
  }, [portrait, isMobile, started, forceTick]);

  useEffect(() => {
    if (!isMobile || !started) return;
    setShowTapHint(true);
    const id = window.setTimeout(() => setShowTapHint(false), 3000);
    return () => clearTimeout(id);
  }, [isMobile, started]);

  const getSongTimeFn = useMemo(
    () => () => (transportRef.current ? getSongTime(transportRef.current) : 0),
    [],
  );

  const getVerdict = useMemo(
    () => (eventId: string, gpString: number) => verdictsRef.current.get(verdictKey(eventId, gpString)),
    [],
  );

  const flushDebugCaptureKeepalive = useCallback((reason: DebugReportFlushReason) => {
    const cap = debugCaptureRef.current;
    if (!debugCaptureEnabledRef.current || !livePlayAlongInput(sourceRef.current) || cap.length === 0)
      return;

    const runIso =
      runStartedAtRef.current != null
        ? new Date(runStartedAtRef.current).toISOString()
        : new Date().toISOString();

    const report = cap.snapshot({
      songId,
      trackId,
      runStartedAt: runIso,
      latencyMs,
      chartTuning: chart.meta.tuning,
      capoFret: chart.meta.capoFret ?? null,
      capturedAtIso: new Date().toISOString(),
      reason,
      ...(debugAudioSampleRateRef.current != null
        ? { audioSampleRate: debugAudioSampleRateRef.current }
        : {}),
    });
    const body = cap.serializeReport(report);
    cap.clear();
    /**
     * `keepalive` is limited (~64 KB in flight per origin in Chromium); payloads with FFT + wave snippets
     * usually exceed this and may be dropped. Prefer pause / manual send for reliable upload.
     */
    try {
      void fetch("/api/debug/note-decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      });
    } catch {
      /* ignore */
    }
  }, [songId, trackId, latencyMs, chart.meta.tuning, chart.meta.capoFret]);

  const flushDebugCaptureToApi = useCallback(
    async (reason: DebugReportFlushReason): Promise<{ ok: boolean; key?: string; error?: string }> => {
      const cap = debugCaptureRef.current;
      if (!debugCaptureEnabledRef.current || !livePlayAlongInput(sourceRef.current) || cap.length === 0) {
        return { ok: false, error: "No debug data to send" };
      }

      let audioBlob: Blob | null = null;
      if (sourceRef.current === "mic" && debugSessionRecordRef.current) {
        await stopSessionRecordingSegment();
        const parts = recordChunksRef.current;
        if (parts.length > 0) {
          const blob = new Blob(parts, { type: lastRecorderMimeRef.current });
          audioBlob = blob.size > 0 ? blob : null;
        }
        recordChunksRef.current = [];
      }

      const runIso =
        runStartedAtRef.current != null
          ? new Date(runStartedAtRef.current).toISOString()
          : new Date().toISOString();

      const report = cap.snapshot({
        songId,
        trackId,
        runStartedAt: runIso,
        latencyMs,
        chartTuning: chart.meta.tuning,
        capoFret: chart.meta.capoFret ?? null,
        capturedAtIso: new Date().toISOString(),
        reason,
        ...(debugAudioSampleRateRef.current != null
          ? { audioSampleRate: debugAudioSampleRateRef.current }
          : {}),
      });
      const body = cap.serializeReport(report);
      const res = await fetch("/api/debug/note-decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return { ok: false, error: errText || `HTTP ${res.status}` };
      }
      const data = (await res.json().catch(() => ({}))) as { key?: string };
      cap.clear();
      if (audioBlob && data.key) {
        const mime = audioBlob.type || lastRecorderMimeRef.current;
        await fetch(`/api/debug/session-audio?jsonKey=${encodeURIComponent(data.key)}`, {
          method: "POST",
          headers: { "Content-Type": mime },
          body: audioBlob,
        });
      }
      return { ok: true, key: data.key };
    },
    [songId, trackId, latencyMs, chart.meta.tuning, chart.meta.capoFret, stopSessionRecordingSegment],
  );

  flushDebugKeepaliveRef.current = flushDebugCaptureKeepalive;
  flushDebugToApiRef.current = flushDebugCaptureToApi;

  const onSendDebugReport = useCallback(async () => {
    setDebugReportBusy(true);
    setDebugReportMsg(null);
    setDebugUploadedKey(null);
    try {
      const res = await flushDebugCaptureToApi("manual");
      if (res.ok) {
        setDebugReportMsg(res.key ? `Uploaded ${res.key}` : "Uploaded debug report");
        setDebugUploadedKey(res.key ?? null);
      } else setDebugReportMsg(res.error ?? "Upload failed");
    } catch (e) {
      setDebugReportMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setDebugReportBusy(false);
      forceTick();
    }
  }, [flushDebugCaptureToApi, forceTick]);

  const postSaveRun = useCallback(
    async (src: PlayAlongSource) => {
      const scoredEvents = chart.events.filter((ev) =>
        ev.notes.every((n) => verdictsRef.current.has(verdictKey(ev.id, n.string))),
      ).length;
      const completionPct = chart.events.length ? scoredEvents / chart.events.length : 1;
      const res = await fetch(`/api/songs/${songId}/tracks/${trackId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score: scoreStateRef.current.total,
          maxMultiplier: maxMultRef.current,
          completionPct,
          counts: { ...countsRef.current },
          durationSec: chart.duration || 0,
          source: src,
          startedAt: runStartedAtRef.current != null ? new Date(runStartedAtRef.current).toISOString() : undefined,
        }),
      });
      if (res.ok) {
        setBestScore((b) => Math.max(b, scoreStateRef.current.total));
        if (
          (src === "mic" || src === "file") &&
          debugCaptureEnabledRef.current &&
          debugCaptureRef.current.length > 0
        ) {
          void flushDebugCaptureToApi("run-complete").then((d) => {
            if (d.ok) setDebugReportMsg(d.key ? `Debug uploaded: ${d.key}` : "Debug uploaded");
            forceTick();
          });
        }
      }
    },
    [chart.duration, chart.events, songId, trackId, flushDebugCaptureToApi, forceTick],
  );

  useEffect(() => {
    if (!playAlong || !livePlayAlongInput(source) || practiceMode !== "perform") return;
    const tr = transportRef.current;
    if (!tr?.playing) return;
    const dur = chart.duration || 0;
    if (dur <= 0) return;
    if (getSongTime(tr) < dur - 0.05) return;
    if (savedRunRef.current) return;
    savedRunRef.current = true;
    setSaveBusy(true);
    void postSaveRun(source).finally(() => {
      setSaveBusy(false);
      forceTick();
    });
  }, [tick, playAlong, source, practiceMode, chart.duration, postSaveRun, forceTick]);

  useEffect(() => {
    if (!playAlong) return;
    const tr = transportRef.current;
    if (!tr?.playing) return;
    const adjustedSongTime = getSongTime(tr) + latencyMs / 1000;
    const winSec = VERDICT_WINDOWS_MS.off / 1000;
    const dbgOn = debugCaptureEnabledRef.current && livePlayAlongInput(source);

    for (const ev of chart.events) {
      const anyPendingLate = ev.notes.some((n) => {
        const key = verdictKey(ev.id, n.string);
        if (verdictsRef.current.has(key)) return false;
        return adjustedSongTime > ev.t0 + winSec;
      });
      if (
        anyPendingLate &&
        dbgOn &&
        !debugMissLoggedRef.current.has(ev.id)
      ) {
        debugMissLoggedRef.current.add(ev.id);
        const timingErr = adjustedSongTime * 1000 - ev.t0 * 1000;
        debugCaptureRef.current.push({
          songTimeSec: adjustedSongTime,
          audioContextTime: null,
          outcome: "missed-no-onset",
          latencyMsSetting: latencyMs,
          verdict: null,
          timingErrorMs: timingErr,
          expectedEvent: snapshotChartEvent(ev),
          isPoly: ev.notes.filter((x) => !x.dead).length > 1,
          rms: 0,
          flux: null,
          fluxThreshold: null,
          candidates: [{ eventId: ev.id, deltaSec: adjustedSongTime - ev.t0 }],
          trace: null,
          spectrum: [],
          waveSnippet: [],
          detectedMidiGlob: null,
          ...(pitchDiagRef.current != null ? { pitchTelemetry: pitchDiagRef.current } : {}),
        });
      }

      for (const n of ev.notes) {
        const key = verdictKey(ev.id, n.string);
        if (verdictsRef.current.has(key)) continue;
        if (adjustedSongTime <= ev.t0 + winSec) continue;
        void applyVerdictForString(ev.id, n.string, "miss", adjustedSongTime * 1000 - ev.t0 * 1000);
      }
    }
  }, [tick, playAlong, chart, latencyMs, applyVerdictForString, source]);

  useEffect(() => {
    if (!playAlong || !livePlayAlongInput(source)) return;
    const tr = transportRef.current;
    if (!tr) return;
    let cancelled = false;
    let capture: AudioCaptureWorklet | null = null;
    const tuning = chart.meta.tuning;
    const capoFret = chart.meta.capoFret;
    const winSec = VERDICT_WINDOWS_MS.off / 1000;

    const triggerWrongFlash = (detectedMidi: number) => {
      if (tuning.length !== 6) return;
      const inf = inferPlayedStringFret(detectedMidi, tuning, capoFret);
      window.clearTimeout(wrongFlashTimerRef.current);
      setWrongNoteFlash({
        detectedMidi,
        inferredString: inf?.string ?? null,
        inferredFret: inf?.fret ?? null,
      });
      wrongFlashTimerRef.current = window.setTimeout(() => {
        setWrongNoteFlash(null);
      }, WRONG_NOTE_FLASH_MS);
    };

    const disposeCapture = () => {
      basicPitchDetectorRef.current?.attachCapture(null);
      basicPitchDetectorRef.current?.stop();
      capture?.disconnect();
      capture = null;
    };

    const onCapturePayload = (payload: OnsetPayload) => {
      if (cancelled) return;
      const tr2 = transportRef.current;
      if (!tr2?.playing) return;

      const songTime = audioCtxTimeToSongSec(tr2, payload.audioContextTime);
      debugAudioSampleRateRef.current = payload.sampleRate;
      const dbgOn = debugCaptureEnabledRef.current && livePlayAlongInput(sourceRef.current);
      const flux = typeof payload.flux === "number" ? payload.flux : null;
      const fluxThreshold = typeof payload.fluxThreshold === "number" ? payload.fluxThreshold : null;
      const specNums = dbgOn ? DebugCapture.copySpectrum(payload.spectrum) : [];
      const waveNums = dbgOn ? DebugCapture.copyWaveSnippet(payload.waveSnippet) : [];

      const cands: { ev: ChartEvent; d: number }[] = [];
      for (const ev of chart.events) {
        if (!eventHasPendingString(ev, verdictsRef.current)) continue;
        const d = Math.abs(ev.t0 - songTime);
        if (d > winSec) continue;
        cands.push({ ev, d });
      }
      cands.sort((a, b) => a.d - b.d);

      const candSnap = cands.slice(0, 2).map((c) => ({
        eventId: c.ev.id,
        deltaSec: c.d,
      }));

      const best = cands[0] ?? null;
      if (!best) {
        if (dbgOn) {
          debugCaptureRef.current.push({
            songTimeSec: songTime,
            audioContextTime: payload.audioContextTime,
            outcome: "unmatched-onset",
            latencyMsSetting: latencyMs,
            verdict: null,
            timingErrorMs: null,
            expectedEvent: null,
            isPoly: null,
            rms: payload.rms,
            flux,
            fluxThreshold,
            candidates: candSnap,
            trace: null,
            spectrum: specNums,
            waveSnippet: waveNums,
            detectedMidiGlob: null,
            ...(pitchDiagRef.current != null ? { pitchTelemetry: pitchDiagRef.current } : {}),
          });
        }
        return;
      }

      const pdCfg = loadPitchDetectionConfig();
      const onsetCtxMs = payload.audioContextTime * 1000;
      const tEv0 = typeof performance !== "undefined" ? performance.now() : 0;
      const evidence =
        basicPitchDetectorRef.current?.midisEvidenceAt(onsetCtxMs) ?? new Set<number>();
      const tEv1 = typeof performance !== "undefined" ? performance.now() : 0;
      const useFallback = evidence.size === 0 && pdCfg.fallbackHarmonicVerifier;

      const tSc0 = typeof performance !== "undefined" ? performance.now() : 0;
      const r = useFallback
        ? scoreOnsetAgainstEvent(
            best.ev,
            songTime,
            payload.waveSnippet,
            payload.spectrum,
            payload.sampleRate,
            latencyMs,
          )
        : scoreBpOnsetAgainstEvent(best.ev, songTime, evidence, latencyMs);
      const tSc1 = typeof performance !== "undefined" ? performance.now() : 0;

      let appliedPitchHit = false;
      for (const nh of r.notes) {
        if (nh.pitchOk && nh.verdict !== "miss") {
          const ok = applyVerdictForString(best.ev.id, nh.string, nh.verdict, nh.timingErrorMs);
          if (ok) appliedPitchHit = true;
        }
      }

      if (dbgOn) {
        const outcome = classifyOnsetDebugOutcome(appliedPitchHit, r, best.ev);
        let refNh = r.notes[0];
        for (let i = 0; i < best.ev.notes.length; i++) {
          const cn = best.ev.notes[i];
          const nh = r.notes[i];
          if (cn && !cn.dead && nh) {
            refNh = nh;
            break;
          }
        }
        let traceSnap = buildTraceSnapshots(r);
        if (traceSnap?.kind === "bp" && !useFallback) {
          const dropped = basicPitchDetectorRef.current?.stabilizerDroppedMidisAt(onsetCtxMs) ?? [];
          if (dropped.length) traceSnap = { ...traceSnap, stabilizerDroppedMidis: dropped };
        }
        debugCaptureRef.current.push({
          songTimeSec: songTime,
          audioContextTime: payload.audioContextTime,
          outcome,
          latencyMsSetting: latencyMs,
          verdict: refNh?.verdict ?? null,
          timingErrorMs: refNh?.timingErrorMs ?? null,
          expectedEvent: snapshotChartEvent(best.ev),
          isPoly: r.isPoly,
          rms: payload.rms,
          flux,
          fluxThreshold,
          candidates: candSnap,
          trace: traceSnap,
          spectrum: specNums,
          waveSnippet: waveNums,
          detectedMidiGlob: r.detectedMidi,
          handlerProbeMs: { evidenceMs: tEv1 - tEv0, scoreMs: tSc1 - tSc0 },
          ...(pitchDiagRef.current != null ? { pitchTelemetry: pitchDiagRef.current } : {}),
        });
      }

      if (
        !appliedPitchHit &&
        payload.rms >= MIC_RMS_GATE_HINT &&
        r.detectedMidi != null &&
        Number.isFinite(r.detectedMidi)
      ) {
        triggerWrongFlash(r.detectedMidi);
      }
    };

    const setupAndRun = async (stream: MediaStream) => {
      const ctx = tr.ctx;
      if (cancelled) return;
      disposeCapture();
      capture = new AudioCaptureWorklet(ctx);
      capture.setOnsetHandler(onCapturePayload);
      try {
        await capture.connect(stream);
        if (!cancelled) {
          const det = basicPitchDetectorRef.current ?? new BasicPitchDetector(ctx);
          basicPitchDetectorRef.current = det;
          det.attachCapture(capture);
          det.onMetrics = (snap) => {
            pitchDiagRef.current = snap;
          };
          await det.init().catch(() => {
            /* model load failure — fall back entirely to harmonic path */
          });
          det.start();
        }
        setPlayAlongError(null);
      } catch (err) {
        if (!cancelled) setPlayAlongError(describeMicError(err));
        disposeCapture();
      }
    };

    const setupFileAndRun = async () => {
      const ctx = tr.ctx;
      if (cancelled) return;
      const el = fileInputAudioRef.current;
      if (!el?.src) {
        if (!cancelled) setPlayAlongError("Choose an audio file for File input.");
        return;
      }
      disposeCapture();
      capture = new AudioCaptureWorklet(ctx);
      capture.setOnsetHandler(onCapturePayload);
      try {
        await tr.ctx.resume().catch(() => {});
        let mes = fileMediaElementSourceRef.current;
        if (!mes) {
          mes = tr.ctx.createMediaElementSource(el);
          fileMediaElementSourceRef.current = mes;
        }
        await capture.connectFromNode(mes, { gain: 0.88, destination: tr.outputGain });
        if (!cancelled) {
          const det = basicPitchDetectorRef.current ?? new BasicPitchDetector(ctx);
          basicPitchDetectorRef.current = det;
          det.attachCapture(capture);
          det.onMetrics = (snap) => {
            pitchDiagRef.current = snap;
          };
          await det.init().catch(() => {
            /* model load failure — fall back entirely to harmonic path */
          });
          det.start();
        }
        setPlayAlongError(null);
      } catch (err) {
        if (!cancelled)
          setPlayAlongError(err instanceof Error ? err.message : "File audio routing failed.");
        disposeCapture();
      }
    };
    if (source === "file") {
      void setupFileAndRun();
    } else {
      const existing = micStreamRef.current;
      if (existing && existing.getAudioTracks().some((t) => t.readyState === "live")) {
        void setupAndRun(existing);
      } else {
        void requestMicStream()
          .then((s) => {
            if (!cancelled) {
              void tr.ctx.resume().catch(() => {});
              void setupAndRun(s);
            }
          })
          .catch((err) => {
            if (!cancelled) setPlayAlongError(describeMicError(err));
          });
      }
    }

    return () => {
      cancelled = true;
      disposeCapture();
      window.clearTimeout(wrongFlashTimerRef.current);
    };
  }, [playAlong, source, chart, latencyMs, applyVerdictForString, requestMicStream, debugInputFileName]);

  useEffect(() => {
    if (!playAlong || source !== "file") return;
    const tr = transportRef.current;
    const el = fileInputAudioRef.current;
    if (!tr?.playing || !el?.src) return;
    const song = getSongTime(tr);
    const rate = tr.playbackRate > 0 ? tr.playbackRate : 1;
    if (el.playbackRate !== rate) el.playbackRate = rate;
    if (song < 0) {
      if (!el.paused) el.pause();
      el.currentTime = 0;
      return;
    }
    const drift = Math.abs(el.currentTime - song);
    if (drift > 0.12) el.currentTime = song;
    if (el.paused) void el.play().catch(() => {});
  }, [tick, playAlong, source]);

  // Release the mic when play-along is off or switched to emulate so the browser
  // tab indicator clears and other apps can use the device.
  useEffect(() => {
    if (playAlong && source === "mic") return;
    stopMicStream();
  }, [playAlong, source, stopMicStream]);

  // Unmount safety net.
  useEffect(() => {
    return () => {
      stopMicStream();
    };
  }, [stopMicStream]);

  useEffect(() => {
    if (!playAlong || source !== "emulate") return;
    let raf = 0;
    const loop = () => {
      const tr = transportRef.current;
      if (!tr?.playing) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const songTime = getSongTime(tr);
      const adjustedSongTimeMs = songTime * 1000 + latencyMs;
      for (const ev of chart.events) {
        if (!eventHasPendingString(ev, verdictsRef.current)) continue;
        const deltaSec = ev.t0 - songTime;
        if (deltaSec < -1 || deltaSec > EMULATE_LOOKAHEAD_SEC) continue;
        let offsetMs = emulateOffsetsRef.current.get(ev.id);
        if (offsetMs == null) {
          const jitterMs =
            emulateJitterMs > 0 ? (Math.random() * 2 - 1) * emulateJitterMs : 0;
          offsetMs = emulateDelayMs + jitterMs;
          emulateOffsetsRef.current.set(ev.id, offsetMs);
        }
        if (adjustedSongTimeMs < ev.t0 * 1000 + offsetMs) continue;
        const v = classifyTiming(offsetMs);
        for (const n of ev.notes) {
          void applyVerdictForString(ev.id, n.string, v, offsetMs);
        }
        emulateOffsetsRef.current.delete(ev.id);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [
    playAlong,
    source,
    chart,
    latencyMs,
    emulateDelayMs,
    emulateJitterMs,
    applyVerdictForString,
  ]);

  const onSaveRun = useCallback(() => {
    setSaveBusy(true);
    void postSaveRun(source).finally(() => {
      setSaveBusy(false);
      forceTick();
    });
  }, [postSaveRun, source, forceTick]);

  const clearEmulateOffsetsOnly = useCallback(() => {
    emulateOffsetsRef.current.clear();
  }, []);

  const meta = chart.meta;
  const bpmLabel = meta.tempoMap[0]?.bpm;
  const tuningLabel = meta.tuning.length ? meta.tuning.join(" ") : "—";
  const capoLabel =
    meta.capoFret != null && meta.capoFret > 0 ? `Capo ${meta.capoFret}` : "No capo";
  const keyLabel = meta.key ?? "—";

  const trPlaying = transportRef.current?.playing ?? false;
  useScreenWakeLock(trPlaying);

  const speedLocked = practiceMode === "perform";
  const canSaveRun = playAlong && practiceMode === "perform";

  const persistDebugCaptureEnabled = useCallback((enabled: boolean) => {
    setDebugCaptureEnabled(enabled);
    setStoredDebugCapture(enabled);
    if (!enabled) {
      setDebugReportMsg(null);
      setDebugUploadedKey(null);
    }
  }, []);

  const controlsProps = {
    transportRef,
    playbackVolume,
    setPlaybackVolume,
    playbackRate,
    onPlaybackRateCommit: commitPlaybackRate,
    speedLocked,
    latencyMs,
    setLatencyMs,
    playAlong,
    setPlayAlong,
    source,
    setSource,
    emulateDelayMs,
    setEmulateDelayMs,
    emulateJitterMs,
    setEmulateJitterMs,
    onClearEmulateOffsets: clearEmulateOffsetsOnly,
    clearPlayAlongState,
    practiceMode,
    setPracticeMode,
    scoreSnap,
    bestScore,
    saveBusy,
    onSaveRun,
    canSaveRun,
    chartDuration: chart.duration || 0,
    getSongTime: getSongTimeFn,
    onSeek,
    lastHit,
    wrongNoteFlash,
    forceTick,
    playAlongError,
    setPlayAlongError,
    acquireMic,
    debugCaptureEnabled,
    setDebugCaptureEnabled: persistDebugCaptureEnabled,
    onSendDebugReport,
    debugReportBusy,
    debugReportMsg,
    debugUploadedKey,
    songId,
    trackId,
    debugSessionRecord,
    setDebugSessionRecord: persistDebugSessionRecord,
    debugInputFileName,
    onDebugAudioFile: onDebugFileChange,
  };

  const desktopControls = <PracticeControls {...controlsProps} showSeek desktopTwoColumn />;
  const mobileControls = <PracticeControls {...controlsProps} showSeek={false} />;

  if (isMobile && !started) {
    return (
      <PracticeIntro
        songTitle={songTitle}
        trackName={trackName}
        bpm={bpmLabel}
        tuning={tuningLabel}
        capoLabel={capoLabel}
        keyLabel={keyLabel}
        onStart={() => setStarted(true)}
      />
    );
  }

  const highwayDesktop = (
    <HighwayCanvas
      chart={chart}
      getSongTime={getSongTimeFn}
      getVerdict={getVerdict}
      capoFret={meta.capoFret}
      height={360}
      timingFlashRef={timingFlashRef}
      timingFlashStartedMsRef={timingFlashStartedMsRef}
    />
  );

  const highwayMobile = (
    <HighwayCanvas
      chart={chart}
      getSongTime={getSongTimeFn}
      getVerdict={getVerdict}
      capoFret={meta.capoFret}
      height={360}
      timingFlashRef={timingFlashRef}
      timingFlashStartedMsRef={timingFlashStartedMsRef}
    />
  );

  if (isMobile && started) {
    return (
      <>
        <audio ref={fileInputAudioRef} className="hidden" crossOrigin="anonymous" playsInline preload="auto" />
        <MobilePlayShell
        highway={highwayMobile}
        portrait={portrait}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        showTapHint={showTapHint}
        speedExpanded={speedExpanded}
        setSpeedExpanded={setSpeedExpanded}
        playbackRate={playbackRate}
        onSpeedCommit={commitPlaybackRate}
        speedLocked={speedLocked}
        playing={trPlaying}
        audioBusy={audioBusy}
        onPlayPause={onPlayPause}
        onRestart={restart}
        practiceMode={practiceMode}
        playAlong={playAlong}
        scoreDisplay={scoreSnap.total.toLocaleString()}
        chartDuration={chart.duration || 0}
        getSongTime={getSongTimeFn}
        onSeek={onSeek}
        onCanvasTap={() => {
          setMenuOpen((o) => !o);
        }}
        controlsPanel={mobileControls}
        speedMin={0.5}
        speedMax={2}
        speedStep={0.05}
        onExitToLibrary={exitToLibrary}
      />
      </>
    );
  }

  const transportBtn =
    "p-3 rounded-xl bg-zinc-800 text-white hover:bg-zinc-700 touch-manipulation disabled:opacity-40 min-h-[48px] min-w-[48px] flex items-center justify-center";

  return (
    <div className="flex flex-col gap-4 w-full max-w-6xl">
      <audio ref={fileInputAudioRef} className="hidden" crossOrigin="anonymous" playsInline preload="auto" />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400 font-mono">
        <span>
          <span className="text-zinc-500">BPM</span> {bpmLabel ?? "—"}
        </span>
        <span className="min-w-0 break-all">
          <span className="text-zinc-500">Tuning</span> {tuningLabel}
        </span>
        <span>
          <span className="text-zinc-500">Capo</span> {capoLabel}
        </span>
        <span>
          <span className="text-zinc-500">Key</span> {keyLabel}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={transportBtn} aria-label="Restart" onClick={restart}>
          <IconRestart className="w-6 h-6" />
        </button>
        <button
          type="button"
          className={transportBtn}
          disabled={audioBusy}
          aria-label={trPlaying ? "Pause" : "Play"}
          onClick={onPlayPause}
        >
          {audioBusy ? (
            <span className="text-xs px-1">…</span>
          ) : trPlaying ? (
            <IconPause className="w-6 h-6" />
          ) : (
            <IconPlay className="w-6 h-6 pl-0.5" />
          )}
        </button>
        {playAlong && (
          <span
            className={`text-xs font-medium px-2 py-1 rounded-md ${
              practiceMode === "perform"
                ? "bg-emerald-900/60 text-emerald-200"
                : "bg-amber-900/50 text-amber-200"
            }`}
          >
            {practiceMode === "perform" ? "Perform" : "Practice"}
          </span>
        )}
        {playAlong && practiceMode === "perform" && (
          <span className="text-sm font-mono tabular-nums text-white bg-zinc-800 px-2 py-1 rounded-md">
            {scoreSnap.total.toLocaleString()}
          </span>
        )}
      </div>

      <div className="w-full min-w-0">{highwayDesktop}</div>

      <div className="w-full">{desktopControls}</div>
    </div>
  );
}
