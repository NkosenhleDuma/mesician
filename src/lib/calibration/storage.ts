import type { StringProfile } from "./string-profile";
import { stringProfileKey as computeStringProfileKey } from "./string-profile";

const KEY = "mesician_input_latency_ms";
const PLAYBACK_VOL_KEY = "mesician_playback_volume";
const PLAY_ALONG_KEY = "mesician_play_along_enabled";
const PLAY_ALONG_SOURCE_KEY = "mesician_play_along_source";
const EMULATE_DELAY_KEY = "mesician_emulate_delay_ms";
const EMULATE_JITTER_KEY = "mesician_emulate_jitter_ms";

/** Slider gain (0–2); UI shows as percent. Effective output = value × 5 (0.8 → 4.0). */
const DEFAULT_PLAYBACK_VOLUME = 0.8;
const DEFAULT_PLAY_ALONG_SOURCE = "mic";
const PRACTICE_MODE_KEY = "mesician_practice_mode";
const DEBUG_CAPTURE_KEY = "mesician_debug_capture_enabled";

const DEBUG_SESSION_RECORD_KEY = "mesician_debug_session_record";
const STRING_PROFILE_KEY = "mesician_string_profile_v1";

export type PlayAlongSource = "mic" | "emulate" | "file";
export type PracticeMode = "practice" | "perform";

function clampStoredInt(value: number, min: number, max: number): number {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  return Math.min(max, Math.max(min, rounded));
}

function getStoredInt(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw == null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? clampStoredInt(parsed, min, max) : fallback;
}

export function getStoredPlaybackVolume(): number {
  if (typeof window === "undefined") return DEFAULT_PLAYBACK_VOLUME;
  const v = window.localStorage.getItem(PLAYBACK_VOL_KEY);
  if (v == null) return DEFAULT_PLAYBACK_VOLUME;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return DEFAULT_PLAYBACK_VOLUME;
  return Math.min(2, Math.max(0, n));
}

export function setStoredPlaybackVolume(gain: number) {
  if (typeof window === "undefined") return;
  const g = Math.min(2, Math.max(0, gain));
  window.localStorage.setItem(PLAYBACK_VOL_KEY, String(g));
}

export function getStoredPlayAlongEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PLAY_ALONG_KEY) === "1";
}

export function setStoredPlayAlongEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLAY_ALONG_KEY, enabled ? "1" : "0");
}

export function getStoredPlayAlongSource(): PlayAlongSource {
  if (typeof window === "undefined") return DEFAULT_PLAY_ALONG_SOURCE;
  const raw = window.localStorage.getItem(PLAY_ALONG_SOURCE_KEY);
  if (raw === "emulate") return "emulate";
  if (raw === "file") return "file";
  return DEFAULT_PLAY_ALONG_SOURCE;
}

export function setStoredPlayAlongSource(source: PlayAlongSource) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLAY_ALONG_SOURCE_KEY, source);
}

export function getStoredEmulateDelayMs(): number {
  return getStoredInt(EMULATE_DELAY_KEY, 0, -200, 200);
}

export function setStoredEmulateDelayMs(ms: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EMULATE_DELAY_KEY, String(clampStoredInt(ms, -200, 200)));
}

export function getStoredEmulateJitterMs(): number {
  return getStoredInt(EMULATE_JITTER_KEY, 0, 0, 200);
}

export function setStoredEmulateJitterMs(ms: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EMULATE_JITTER_KEY, String(clampStoredInt(ms, 0, 200)));
}

export function getStoredLatencyMs(): number {
  return getStoredInt(KEY, 0, -500, 500);
}

export function setStoredLatencyMs(ms: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, String(clampStoredInt(ms, -500, 500)));
}

export function getStoredPracticeMode(): PracticeMode {
  if (typeof window === "undefined") return "practice";
  const raw = window.localStorage.getItem(PRACTICE_MODE_KEY);
  return raw === "perform" ? "perform" : "practice";
}

export function setStoredPracticeMode(mode: PracticeMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PRACTICE_MODE_KEY, mode);
}

export function getStoredDebugCapture(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEBUG_CAPTURE_KEY) === "1";
}

export function setStoredDebugCapture(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEBUG_CAPTURE_KEY, enabled ? "1" : "0");
}

export function getStoredDebugSessionRecord(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEBUG_SESSION_RECORD_KEY) === "1";
}

export function setStoredDebugSessionRecord(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEBUG_SESSION_RECORD_KEY, enabled ? "1" : "0");
}

function isStringProfile(x: unknown): x is StringProfile {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    o.version === 1 &&
    typeof o.profileKey === "string" &&
    Array.isArray(o.tuning) &&
    o.tuning.every((t) => typeof t === "string") &&
    (o.capoFret === null || typeof o.capoFret === "number") &&
    typeof o.capturedAtIso === "string" &&
    Array.isArray(o.strings)
  );
}

/** Latest saved string calibration profile (may not match current chart tuning/capo — check profileKey). */
export function getStoredStringProfile(): StringProfile | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STRING_PROFILE_KEY);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isStringProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setStoredStringProfile(profile: StringProfile) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STRING_PROFILE_KEY, JSON.stringify(profile));
}

/** Profile usable for scoring when keys match chart meta */
export function getStringProfileForMeta(
  tuning: string[],
  capoFret: number | null | undefined,
): StringProfile | null {
  const p = getStoredStringProfile();
  if (!p) return null;
  const want = computeStringProfileKey(tuning, capoFret);
  return p.profileKey === want ? p : null;
}
