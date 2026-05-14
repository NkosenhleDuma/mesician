"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useState,
  isValidElement,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type { PracticeMode } from "@/lib/calibration/storage";
import { formatTime } from "./practice-constants";

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

function IconGauge({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M19.4 15a9 9 0 1 0-2.5 4" strokeLinecap="round" />
    </svg>
  );
}

function IconCog({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" strokeLinecap="round" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        strokeLinecap="round"
      />
    </svg>
  );
}

const MOBILE_SEEK_STRIP_PX = 36;

export type MobilePlayShellProps = {
  /** `HighwayCanvas` element; height is overridden from measured layout. */
  highway: ReactElement<{ height?: number }>;
  portrait: boolean;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  showTapHint: boolean;
  speedExpanded: boolean;
  setSpeedExpanded: (v: boolean) => void;
  playbackRate: number;
  onSpeedCommit: (r: number) => void;
  speedLocked: boolean;
  playing: boolean;
  audioBusy: boolean;
  onPlayPause: () => void;
  onRestart: () => void;
  practiceMode: PracticeMode;
  playAlong: boolean;
  scoreDisplay: string;
  chartDuration: number;
  getSongTime: () => number;
  onSeek: (t: number, currentTime: number) => void;
  onCanvasTap: () => void;
  controlsPanel: ReactNode;
  speedMin: number;
  speedMax: number;
  speedStep: number;
  /** Leave unset to hide the Library control (e.g. non-practice wrappers). */
  onExitToLibrary?: () => void;
};

export function MobilePlayShell({
  highway,
  portrait,
  menuOpen,
  setMenuOpen,
  settingsOpen,
  setSettingsOpen,
  showTapHint,
  speedExpanded,
  setSpeedExpanded,
  playbackRate,
  onSpeedCommit,
  speedLocked,
  playing,
  audioBusy,
  onPlayPause,
  onRestart,
  practiceMode,
  playAlong,
  scoreDisplay,
  chartDuration,
  getSongTime,
  onSeek,
  onCanvasTap,
  controlsPanel,
  speedMin,
  speedMax,
  speedStep,
  onExitToLibrary,
}: MobilePlayShellProps) {
  const mainRef = useRef<HTMLDivElement>(null);
  const [highwayHeight, setHighwayHeight] = useState(360);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDismiss = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const scheduleDismiss = useCallback(() => {
    clearDismiss();
    dismissTimerRef.current = setTimeout(() => {
      setMenuOpen(false);
      setSpeedExpanded(false);
    }, 4000);
  }, [clearDismiss, setMenuOpen, setSpeedExpanded]);

  /** Reset the 4s auto-close timer while the menu is open (after control interaction). */
  const bumpMenu = useCallback(() => {
    scheduleDismiss();
  }, [scheduleDismiss]);

  useEffect(() => {
    document.body.classList.add("mobile-no-scroll");
    return () => {
      document.body.classList.remove("mobile-no-scroll");
    };
  }, []);

  useEffect(() => {
    if (menuOpen) scheduleDismiss();
    else clearDismiss();
    return clearDismiss;
  }, [menuOpen, scheduleDismiss, clearDismiss]);

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.clientHeight - MOBILE_SEEK_STRIP_PX;
      setHighwayHeight(Math.max(120, Math.floor(h)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const highwayNode = isValidElement(highway)
    ? cloneElement(highway, { height: highwayHeight })
    : highway;

  const barButton =
    "p-3 rounded-xl bg-zinc-800/90 text-white hover:bg-zinc-700 touch-manipulation disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#12121a] min-h-[100dvh] max-h-[100dvh] overflow-hidden">
      {portrait && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-zinc-950/95 p-6 text-center">
          <p className="text-lg font-medium text-white">Rotate to landscape to keep playing</p>
          <p className="text-sm text-zinc-400 max-w-xs">
            Practice is paused while you’re in portrait. Turn your device, then tap Play.
          </p>
        </div>
      )}

      <div ref={mainRef} className="flex-1 min-h-0 w-full relative">
        <div className="absolute inset-x-0 top-0 bottom-9 min-h-0">
          <div className="absolute inset-0 [&>div]:!min-h-0 h-full w-full">{highwayNode}</div>
          <button
            type="button"
            className="absolute inset-0 z-10 cursor-pointer bg-transparent"
            aria-label="Toggle practice menu"
            onClick={() => {
              onCanvasTap();
            }}
          />
          {showTapHint && !menuOpen && (
            <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-[9] text-[11px] text-zinc-400/90 bg-black/40 px-3 py-1 rounded-full">
              Tap to toggle controls
            </p>
          )}
        </div>

        {menuOpen && (
        <div
          className="absolute top-0 left-0 right-0 z-30 pt-[env(safe-area-inset-top,0px)] px-2 pb-2 bg-zinc-950/85 backdrop-blur-md border-b border-zinc-800/80"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-wrap items-center justify-center gap-2 py-2">
            <button
              type="button"
              className={barButton}
              aria-label="Restart"
              onClick={() => {
                onRestart();
                bumpMenu();
              }}
            >
              <IconRestart className="w-6 h-6" />
            </button>
            <button
              type="button"
              className={barButton}
              disabled={audioBusy}
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => {
                onPlayPause();
                bumpMenu();
              }}
            >
              {audioBusy ? (
                <span className="text-xs px-1">…</span>
              ) : playing ? (
                <IconPause className="w-6 h-6" />
              ) : (
                <IconPlay className="w-6 h-6 pl-0.5" />
              )}
            </button>
            <button
              type="button"
              className={`${barButton} ${speedExpanded ? "ring-2 ring-sky-500/60" : ""} relative`}
              aria-label="Speed"
              disabled={speedLocked}
              onClick={() => {
                if (speedLocked) return;
                setSpeedExpanded(!speedExpanded);
                bumpMenu();
              }}
            >
              <IconGauge className="w-6 h-6" />
              {speedLocked && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-tighter text-amber-400/90">
                  perform
                </span>
              )}
            </button>
            <button
              type="button"
              className={barButton}
              aria-label="Settings"
              onClick={() => {
                setSettingsOpen(true);
                bumpMenu();
              }}
            >
              <IconCog className="w-6 h-6" />
            </button>
            {onExitToLibrary && (
              <button
                type="button"
                className={`${barButton} px-3 text-xs font-semibold tracking-wide`}
                aria-label="Back to library"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen(false);
                  setSpeedExpanded(false);
                  onExitToLibrary();
                }}
              >
                Library
              </button>
            )}
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
              <span className="text-xs font-mono tabular-nums text-white bg-zinc-800 px-2 py-1 rounded-md">
                {scoreDisplay}
              </span>
            )}
          </div>
          {speedExpanded && !speedLocked && (
            <label className="flex flex-col gap-1 px-3 pb-2 text-xs text-zinc-300" onClick={(e) => e.stopPropagation()}>
              Speed ({playbackRate.toFixed(2)}×)
              <input
                type="range"
                min={speedMin}
                max={speedMax}
                step={speedStep}
                value={playbackRate}
                className="w-full"
                onChange={(e) => onSpeedCommit(Number(e.target.value))}
                onMouseDown={bumpMenu}
                onTouchStart={bumpMenu}
              />
            </label>
          )}
          {speedLocked && (
            <p className="text-[11px] text-center text-amber-400/90 pb-2">Speed locked in Perform</p>
          )}
        </div>
        )}

        {settingsOpen && (
        <div
          className="absolute inset-0 z-40 flex flex-col justify-end bg-black/50"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="max-h-[75dvh] overflow-y-auto rounded-t-2xl bg-zinc-900 border-t border-zinc-700 p-4 pb-[env(safe-area-inset-bottom,1rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Settings</h3>
              <button
                type="button"
                className="text-zinc-400 text-sm"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>
            {controlsPanel}
          </div>
        </div>
        )}

        <div
          className="absolute bottom-0 left-0 right-0 z-20 border-t border-zinc-800 bg-zinc-950/95 px-2 py-1 pb-[max(4px,env(safe-area-inset-bottom))]"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="range"
            min={0}
            max={chartDuration || 1}
            step={0.05}
            value={getSongTime()}
            onChange={(e) => {
              const t = Number(e.target.value);
              onSeek(t, getSongTime());
            }}
            className="w-full accent-emerald-500 h-1.5"
          />
          <div className="flex justify-between text-[10px] font-mono text-zinc-500 leading-tight">
            <span>{formatTime(getSongTime())}</span>
            <span>{formatTime(chartDuration || 0)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
