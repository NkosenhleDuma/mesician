"use client";

import { useEffect, useRef } from "react";

/** Narrow type when lib.dom WakeLock types differ across TS versions */
type WakeLockSentinelLike = EventTarget & {
  readonly released: boolean;
  release: () => Promise<void>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

/**
 * Keeps the screen on while `active` is true (e.g. during playback).
 * Uses the Screen Wake Lock API where available (Chrome, Safari 16.4+, Firefox Android 126+).
 * Silently no-ops if unsupported or request fails.
 */
export function useScreenWakeLock(active: boolean): void {
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (typeof navigator === "undefined" || typeof document === "undefined") return;
    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock?.request) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    let inFlight = false;

    const release = () => {
      if (!sentinel) return;
      const s = sentinel;
      sentinel = null;
      void s.release().catch(() => {});
    };

    const acquire = async () => {
      if (cancelled || inFlight) return;
      if (!activeRef.current || document.visibilityState !== "visible") {
        release();
        return;
      }
      if (sentinel && !sentinel.released) return;

      inFlight = true;
      try {
        const s = await nav.wakeLock!.request("screen");
        if (cancelled) {
          void s.release().catch(() => {});
          return;
        }
        sentinel = s;
        s.addEventListener("release", () => {
          if (sentinel === s) sentinel = null;
          if (cancelled) return;
          if (!activeRef.current || document.visibilityState !== "visible") return;
          void acquire();
        });
      } catch {
        sentinel = null;
      } finally {
        inFlight = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
      else release();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [active]);
}
