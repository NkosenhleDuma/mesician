"use client";

import type { RefObject } from "react";
import Link from "next/link";
import type { Verdict } from "@/lib/scoring/engine";
import {
  setStoredPlayAlongEnabled,
  setStoredPlayAlongSource,
  setStoredPlaybackVolume,
  setStoredLatencyMs,
  setStoredEmulateDelayMs,
  setStoredEmulateJitterMs,
  setStoredPracticeMode,
  type PlayAlongSource,
  type PracticeMode,
} from "@/lib/calibration/storage";
import { setPlaybackVolume as setTransportPlaybackVolume } from "@/lib/audio/transport";
import type { TransportState } from "@/lib/audio/transport";
import {
  PLAYBACK_VOL_MIN,
  PLAYBACK_VOL_MAX,
  PLAYBACK_VOL_STEP,
  SPEED_MIN,
  SPEED_MAX,
  SPEED_STEP,
  EMULATE_DELAY_MIN,
  EMULATE_DELAY_MAX,
  EMULATE_JITTER_MIN,
  EMULATE_JITTER_MAX,
  clampSpeed,
  clampInt,
  formatTime,
} from "./practice-constants";

const PLAY_ALONG_SOURCES: { value: PlayAlongSource; label: string }[] = [
  { value: "mic", label: "Mic" },
  { value: "file", label: "File" },
  { value: "emulate", label: "Emulate" },
];

type Counts = { perfect: number; slight: number; off: number; miss: number };

export type ScoreSnap = {
  total: number;
  multiplier: number;
  combo: number;
  maxMultiplier: number;
  counts: Counts;
};

type LastHit = {
  eventId: string;
  string: number;
  verdict: Verdict;
  timingErrorMs: number;
};

/** Brief mic scoring hint when onset fired but no expected pitch matched */
export type WrongNoteFlash = {
  detectedMidi: number | null;
  inferredString: number | null;
  inferredFret: number | null;
};

function clampEmulateDelay(v: number): number {
  return clampInt(v, EMULATE_DELAY_MIN, EMULATE_DELAY_MAX);
}

function clampEmulateJitter(v: number): number {
  return clampInt(v, EMULATE_JITTER_MIN, EMULATE_JITTER_MAX);
}

function formatVerdict(verdict: Verdict): string {
  switch (verdict) {
    case "perfect":
      return "perfect";
    case "slightEarly":
      return "a bit early";
    case "slightLate":
      return "a bit late";
    case "early":
      return "early";
    case "late":
      return "late";
    case "miss":
      return "Missed";
  }
}

function verdictTextClass(verdict: Verdict): string {
  switch (verdict) {
    case "miss":
      return "text-rose-400";
    default:
      return "text-zinc-400";
  }
}

function formatTimingErrorMs(ms: number): string {
  const rounded = Math.round(ms);
  return `${rounded >= 0 ? "+" : ""}${rounded}ms`;
}

export type PracticeControlsProps = {
  transportRef: RefObject<TransportState | null>;
  playbackVolume: number;
  setPlaybackVolume: (v: number) => void;
  playbackRate: number;
  onPlaybackRateCommit: (r: number) => void;
  speedLocked: boolean;
  latencyMs: number;
  setLatencyMs: (v: number) => void;
  playAlong: boolean;
  setPlayAlong: (v: boolean) => void;
  source: PlayAlongSource;
  setSource: (v: PlayAlongSource) => void;
  emulateDelayMs: number;
  setEmulateDelayMs: (v: number) => void;
  emulateJitterMs: number;
  setEmulateJitterMs: (v: number) => void;
  onClearEmulateOffsets: () => void;
  clearPlayAlongState: () => void;
  practiceMode: PracticeMode;
  setPracticeMode: (m: PracticeMode) => void;
  scoreSnap: ScoreSnap;
  bestScore: number;
  saveBusy: boolean;
  onSaveRun: () => void;
  canSaveRun: boolean;
  chartDuration: number;
  showSeek: boolean;
  getSongTime: () => number;
  onSeek: (t: number, currentTime: number) => void;
  lastHit: LastHit | null;
  wrongNoteFlash?: WrongNoteFlash | null;
  forceTick: () => void;
  /** Desktop: two columns — transport-style controls vs play-along. */
  desktopTwoColumn?: boolean;
  playAlongError?: string | null;
  setPlayAlongError?: (msg: string | null) => void;
  /**
   * Acquires a mic stream synchronously from the user gesture (iOS Firefox
   * requires the request to originate inside the click handler). Returns
   * `true` on success, `false` if permission denied / unsupported (error
   * already surfaced via `setPlayAlongError`).
   */
  acquireMic?: () => Promise<boolean>;
  /** Mic debug capture (audio snippets uploaded to backend when sent) */
  debugCaptureEnabled?: boolean;
  setDebugCaptureEnabled?: (enabled: boolean) => void;
  onSendDebugReport?: () => void | Promise<void>;
  debugReportBusy?: boolean;
  debugReportMsg?: string | null;
  debugUploadedKey?: string | null;
  songId?: string;
  trackId?: string;
  /** Mic-only: record WebM sidecar uploaded with debug JSON */
  debugSessionRecord?: boolean;
  setDebugSessionRecord?: (enabled: boolean) => void;
  debugInputFileName?: string | null;
  onDebugAudioFile?: (file: File | null) => void;
};

export function PracticeControls({
  transportRef,
  playbackVolume,
  setPlaybackVolume,
  playbackRate,
  onPlaybackRateCommit,
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
  onClearEmulateOffsets,
  clearPlayAlongState,
  practiceMode,
  setPracticeMode,
  scoreSnap,
  bestScore,
  saveBusy,
  onSaveRun,
  canSaveRun,
  chartDuration,
  showSeek,
  getSongTime,
  onSeek,
  lastHit,
  wrongNoteFlash,
  forceTick,
  desktopTwoColumn = false,
  playAlongError,
  setPlayAlongError,
  acquireMic,
  debugCaptureEnabled = false,
  setDebugCaptureEnabled,
  onSendDebugReport,
  debugReportBusy = false,
  debugReportMsg,
  debugUploadedKey,
  songId,
  trackId,
  debugSessionRecord = false,
  setDebugSessionRecord,
  debugInputFileName,
  onDebugAudioFile,
}: PracticeControlsProps) {
  const transportColumn = (
    <>
      <label className="flex flex-col gap-1 text-sm text-zinc-300">
        Playback volume ({Math.round(playbackVolume * 100)}%)
        <input
          type="range"
          min={PLAYBACK_VOL_MIN}
          max={PLAYBACK_VOL_MAX}
          step={PLAYBACK_VOL_STEP}
          value={playbackVolume}
          onChange={(e) => {
            const v = Math.min(
              PLAYBACK_VOL_MAX,
              Math.max(PLAYBACK_VOL_MIN, Number(e.target.value)),
            );
            setPlaybackVolume(v);
            setStoredPlaybackVolume(v);
            const tr = transportRef.current;
            if (tr) setTransportPlaybackVolume(tr, v);
          }}
          className="w-full"
        />
      </label>

      <div className="flex flex-col gap-1 text-sm text-zinc-300">
        <label className="flex flex-col gap-1">
          Speed ({playbackRate.toFixed(2)}×)
          {speedLocked && (
            <span className="text-[11px] text-amber-400/90">Locked at 1.0× in Perform mode</span>
          )}
          <input
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={SPEED_STEP}
            value={playbackRate}
            disabled={speedLocked}
            onChange={(e) => {
              const r = clampSpeed(Number(e.target.value));
              onPlaybackRateCommit(r);
            }}
            className="w-full disabled:opacity-40"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="shrink-0">Exact</span>
          <input
            type="number"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={SPEED_STEP}
            value={playbackRate}
            disabled={speedLocked}
            onChange={(e) => {
              const r = clampSpeed(Number(e.target.value));
              onPlaybackRateCommit(r);
            }}
            className="bg-zinc-800 rounded px-2 py-1 text-white w-24 disabled:opacity-40"
          />
        </label>
      </div>

      {showSeek && (
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Seek
          <input
            type="range"
            min={0}
            max={chartDuration || 1}
            step={0.05}
            value={getSongTime()}
            onChange={(e) => {
              const t = Number(e.target.value);
              onSeek(t, getSongTime());
              forceTick();
            }}
            className="w-full"
          />
          <div className="text-xs font-mono text-zinc-500">
            {formatTime(getSongTime())} / {formatTime(chartDuration || 0)}
          </div>
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm text-zinc-300">
        Input latency (ms)
        <input
          type="number"
          value={latencyMs}
          onChange={(e) => {
            const v = clampInt(Number(e.target.value), -500, 500);
            setLatencyMs(v);
            setStoredLatencyMs(v);
          }}
          className="bg-zinc-800 rounded px-2 py-2 text-white"
        />
      </label>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
        <p className="text-xs text-zinc-400">Mode</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`px-3 py-2 rounded-md text-sm font-medium ${
              practiceMode === "practice"
                ? "bg-amber-800/60 text-amber-100"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
            onClick={() => {
              setPracticeMode("practice");
              setStoredPracticeMode("practice");
            }}
          >
            Practice
          </button>
          <button
            type="button"
            className={`px-3 py-2 rounded-md text-sm font-medium ${
              practiceMode === "perform"
                ? "bg-emerald-800/60 text-emerald-100"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
            onClick={async () => {
              // Pre-acquire the mic inside the user gesture if perform mode is
              // about to auto-enable play-along on mic source. Result ignored
              // on failure: the error is surfaced and the user can retry.
              if (
                practiceMode !== "perform" &&
                source === "mic" &&
                !playAlong &&
                acquireMic
              ) {
                await acquireMic();
              }
              setPracticeMode("perform");
              setStoredPracticeMode("perform");
            }}
          >
            Perform
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">
          Perform scores saves and locks speed at 1.0×. Practice shows verdicts only.
        </p>
      </div>

      {playAlong && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-lg font-semibold text-white tabular-nums">
              {scoreSnap.total.toLocaleString()}
            </span>
            <span className="text-xs text-zinc-500">score</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-amber-900/40 px-2 py-1 text-amber-100">×{scoreSnap.multiplier}</span>
            <span className="text-zinc-400">combo {scoreSnap.combo}</span>
            <span className="text-zinc-400">max ×{scoreSnap.maxMultiplier}</span>
          </div>
          <div className="text-[11px] text-zinc-500 font-mono">
            P {scoreSnap.counts.perfect} · S {scoreSnap.counts.slight} · O {scoreSnap.counts.off} · M{" "}
            {scoreSnap.counts.miss}
          </div>
          <div className="text-xs text-sky-300">Best {bestScore.toLocaleString()}</div>
          <button
            type="button"
            disabled={saveBusy || !canSaveRun}
            className="w-full px-3 py-2 rounded-md bg-zinc-700 text-sm text-white hover:bg-zinc-600 disabled:opacity-50"
            onClick={onSaveRun}
          >
            {saveBusy ? "Saving…" : "Save run"}
          </button>
        </div>
      )}
    </>
  );

  const playAlongColumn = (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-200">Play-along</span>
        <button
          type="button"
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${
            playAlong
              ? "bg-emerald-600 text-white hover:bg-emerald-500"
              : "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
          }`}
          onClick={async () => {
            const next = !playAlong;
            if (next && source === "mic" && acquireMic) {
              const ok = await acquireMic();
              if (!ok) return; // keep toggle off; error already surfaced
            } else if (!next) {
              setPlayAlongError?.(null);
            }
            setPlayAlong(next);
            setStoredPlayAlongEnabled(next);
            clearPlayAlongState();
          }}
        >
          {playAlong ? "On" : "Off"}
        </button>
      </div>
      {playAlongError && <p className="text-xs text-rose-400">{playAlongError}</p>}
      {playAlong && (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">Source</span>
            <div className="grid grid-cols-3 gap-2">
              {PLAY_ALONG_SOURCES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`px-2 py-2 rounded-md text-sm font-medium ${
                    source === option.value
                      ? "bg-sky-600 text-white"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                  onClick={async () => {
                    if (option.value === source) return;
                    if (source === "file" && option.value !== "file") {
                      onDebugAudioFile?.(null);
                    }
                    if (option.value === "mic" && acquireMic) {
                      const ok = await acquireMic();
                      if (!ok) return; // keep previous source
                    } else {
                      setPlayAlongError?.(null);
                    }
                    setSource(option.value);
                    setStoredPlayAlongSource(option.value);
                    clearPlayAlongState();
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {source === "emulate" ? (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm text-zinc-300">
                Delay (ms)
                <input
                  type="number"
                  min={EMULATE_DELAY_MIN}
                  max={EMULATE_DELAY_MAX}
                  value={emulateDelayMs}
                  onChange={(e) => {
                    const next = clampEmulateDelay(Number(e.target.value));
                    setEmulateDelayMs(next);
                    setStoredEmulateDelayMs(next);
                    onClearEmulateOffsets();
                  }}
                  className="bg-zinc-800 rounded px-2 py-2 text-white"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-300">
                Jitter (ms)
                <input
                  type="number"
                  min={EMULATE_JITTER_MIN}
                  max={EMULATE_JITTER_MAX}
                  value={emulateJitterMs}
                  onChange={(e) => {
                    const next = clampEmulateJitter(Number(e.target.value));
                    setEmulateJitterMs(next);
                    setStoredEmulateJitterMs(next);
                    onClearEmulateOffsets();
                  }}
                  className="bg-zinc-800 rounded px-2 py-2 text-white"
                />
              </label>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {source === "file" ? (
                <>
                  <p className="text-xs text-zinc-400">
                    Route a local audio file through the same onset + Basic Pitch path as the mic, clocked to the chart
                    transport.
                  </p>
                  <label className="flex flex-col gap-1 text-xs text-zinc-300">
                    Audio file
                    <input
                      type="file"
                      accept="audio/*"
                      className="text-[11px] file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        onDebugAudioFile?.(f);
                      }}
                    />
                  </label>
                  {debugInputFileName ? (
                    <p className="text-[11px] font-mono text-zinc-500 truncate" title={debugInputFileName}>
                      {debugInputFileName}
                    </p>
                  ) : (
                    <p className="text-[11px] text-amber-400/90">Select a file to enable detection.</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-zinc-400">
                  Listen to the live audio feed and score the closest pending note.
                </p>
              )}
              {source === "mic" && (
                <label className="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-zinc-600"
                    checked={debugSessionRecord}
                    onChange={(e) => setDebugSessionRecord?.(e.target.checked)}
                    disabled={!setDebugSessionRecord}
                  />
                  <span>
                    <span className="font-medium text-sky-200/95">Record session audio</span> — WebM sidecar with
                    debug uploads (mic only).
                  </span>
                </label>
              )}
              <label className="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-zinc-600"
                  checked={debugCaptureEnabled}
                  onChange={(e) => setDebugCaptureEnabled?.(e.target.checked)}
                  disabled={!setDebugCaptureEnabled}
                />
                <span>
                  <span className="font-medium text-amber-300/95">Capture debug data</span> (FFT spectrum +
                  waveform per onset — uploaded when you save a run or tap Send below). May include identifiable
                  audio.
                </span>
              </label>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={debugReportBusy || !onSendDebugReport || !debugCaptureEnabled}
                  className="w-full px-3 py-2 rounded-md bg-violet-800/70 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
                  onClick={() => {
                    void onSendDebugReport?.();
                  }}
                >
                  {debugReportBusy ? "Uploading debug…" : "Send debug report"}
                </button>
                {debugReportMsg && (
                  <p className="text-[11px] text-zinc-400 font-mono break-all">{debugReportMsg}</p>
                )}
                {debugUploadedKey && songId && trackId && (
                  <Link
                    href={`/library/${songId}/tracks/${trackId}/debug?key=${encodeURIComponent(debugUploadedKey)}`}
                    className="inline-block text-[11px] text-sky-400 hover:text-sky-300"
                  >
                    Open in debug viewer
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  const footerBlock = (
    <>
      {lastHit && (
        <p className={`text-xs font-mono ${verdictTextClass(lastHit.verdict)}`}>
          Str {lastHit.string}: {formatVerdict(lastHit.verdict)} {formatTimingErrorMs(lastHit.timingErrorMs)}
        </p>
      )}
      {wrongNoteFlash && wrongNoteFlash.detectedMidi != null && (
        <p className="text-xs font-mono text-amber-400/95">
          Wrong pitch hint (~MIDI {wrongNoteFlash.detectedMidi.toFixed(1)})
          {wrongNoteFlash.inferredString != null && wrongNoteFlash.inferredFret != null
            ? ` → try Str ${wrongNoteFlash.inferredString}, fret ${wrongNoteFlash.inferredFret}?`
            : ""}
        </p>
      )}
      <a href="/help" className="text-sm text-sky-400 underline">
        Help & calibration tips
      </a>
    </>
  );

  if (desktopTwoColumn) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full items-start">
        <div className="flex flex-col gap-3 min-w-0">
          {transportColumn}
          {footerBlock}
        </div>
        <div className="flex flex-col gap-3 min-w-0">{playAlongColumn}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      {transportColumn}
      {playAlongColumn}
      {footerBlock}
    </div>
  );
}
