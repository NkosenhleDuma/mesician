export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;
export const SPEED_STEP = 0.05;

export const PLAYBACK_VOL_MIN = 0;
export const PLAYBACK_VOL_MAX = 2;
export const PLAYBACK_VOL_STEP = 0.05;

/** Applied at master outputGain: effective = playbackVolume × this (0.8 → 4.0). */
export const PLAYBACK_OUTPUT_GAIN_MULTIPLIER = 5;

export const EMULATE_DELAY_MIN = -200;
export const EMULATE_DELAY_MAX = 200;
export const EMULATE_JITTER_MIN = 0;
export const EMULATE_JITTER_MAX = 200;

export function clampSpeed(v: number): number {
  const x = Number.isFinite(v) ? v : 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(x / SPEED_STEP) * SPEED_STEP));
}

export function clampInt(v: number, min: number, max: number): number {
  const x = Number.isFinite(v) ? Math.round(v) : 0;
  return Math.min(max, Math.max(min, x));
}

export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}
