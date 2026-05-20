import type { ChartEvent, ChartJson } from "@/lib/chart/types";
import { loadGuitarSoundfontForPreview } from "@/lib/audio/guitar-instrument";
import { midiToFreq } from "@/lib/audio/midi-to-freq";
import { scheduleChart } from "@/lib/audio/synth-scheduler";

let previewCtx: AudioContext | null = null;

function ensurePreviewCtx(): AudioContext {
  if (previewCtx && previewCtx.state !== "closed") return previewCtx;
  const Ctor =
    typeof window !== "undefined"
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) {
    throw new Error("Web Audio not available");
  }
  previewCtx = new Ctor();
  return previewCtx;
}

/** When chart end time is missing (legacy debug blobs), match the old fixed sine preview length. */
export const DEBUG_PREVIEW_FALLBACK_DURATION_SEC = 0.38;

const DEBUG_PREVIEW_CHART_META: ChartJson["meta"] = {
  songTitle: "",
  trackName: "",
  tempoMap: [{ t: 0, bpm: 120 }],
  timeSig: [{ t: 0, num: 4, den: 4 }],
  tuning: ["E", "A", "D", "G", "B", "E"],
  capoFret: 0,
};

export function previewDurationFromExpectedSnapshot(ev: {
  t0: number;
  t1?: number;
}): number {
  if (ev.t1 != null && ev.t1 > ev.t0) return Math.max(0.035, ev.t1 - ev.t0);
  return DEBUG_PREVIEW_FALLBACK_DURATION_SEC;
}

/** Build a single-event chart at t=0 for sampler playback (debug page). */
export function chartEventFromExpectedSnapshot(ev: {
  id: string;
  t0: number;
  t1?: number;
  kind: string;
  notes: Array<{ string: number; midi: number; dead?: boolean; palmMute?: boolean }>;
  tech?: string[];
}): ChartEvent {
  const dur = previewDurationFromExpectedSnapshot(ev);
  const kind = ev.kind === "chord" ? "chord" : "note";
  return {
    id: ev.id,
    t0: 0,
    t1: dur,
    kind,
    notes: ev.notes.map((n) => ({
      string: n.string,
      fret: 0,
      midi: n.midi,
      dead: n.dead ?? false,
      ...(n.palmMute ? { palmMute: true } : {}),
    })),
    ...(ev.tech?.length ? { tech: ev.tech } : {}),
  };
}

/** Map unordered detection midis to synthetic string slots for a short preview. */
export function chartEventForDetectedMidis(midis: readonly number[], durationSec: number): ChartEvent {
  const kind = midis.length > 1 ? "chord" : "note";
  const dur = Math.max(0.035, durationSec);
  return {
    id: "debug-detected-preview",
    t0: 0,
    t1: dur,
    kind,
    notes: midis.map((midi, idx) => ({
      string: Math.min(6, idx + 1),
      fret: 0,
      midi: Math.round(midi),
      dead: false,
    })),
  };
}

/**
 * Play one chart event with steel guitar samples when available; otherwise triangle chart fallback from `scheduleChart`.
 */
export async function playGuitarChartEventPreview(ev: ChartEvent): Promise<void> {
  if (typeof window === "undefined") return;
  const ctx = ensurePreviewCtx();
  try {
    if (ctx.state === "suspended") await ctx.resume();
  } catch {
    /* ignore */
  }
  const master = ctx.createGain();
  master.gain.value = 0.95;
  master.connect(ctx.destination);
  const sf = await loadGuitarSoundfontForPreview(ctx, master);
  const chart: ChartJson = {
    version: 1,
    meta: DEBUG_PREVIEW_CHART_META,
    events: [ev],
    duration: Math.max(ev.t1, 0.02),
  };
  const when = ctx.currentTime;
  scheduleChart(ctx, chart, { startWhen: when, outputGain: master }, sf);
}

/** Short sine previews for debug / calibration when guitar CDN is unavailable. */
export async function playMidiPreview(
  midis: readonly number[],
  durationSec = 0.38,
  gain = 0.11,
): Promise<void> {
  if (typeof window === "undefined" || midis.length === 0) return;
  const ctx = ensurePreviewCtx();
  try {
    if (ctx.state === "suspended") await ctx.resume();
  } catch {
    /* ignore */
  }
  const t0 = ctx.currentTime;
  const dur = durationSec;
  const sliceGain = gain / Math.sqrt(Math.min(6, Math.max(1, midis.length)));
  let idx = 0;
  for (const midiRaw of midis) {
    const midi = Math.round(midiRaw);
    if (!Number.isFinite(midi)) continue;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = midiToFreq(midi);
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(g);
    g.connect(ctx.destination);
    const start = t0 + idx * 0.018;
    idx += 1;
    osc.start(start);
    g.gain.linearRampToValueAtTime(sliceGain, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.stop(start + dur + 0.05);
  }
}

/**
 * If `targetDurationSec` is set and longer than the snippet, the buffer is zero-padded so playback lasts
 * that many seconds (extra tail is silence — worklet still only captured one FFT window).
 */
export async function playFloatSnippet(
  samples: readonly number[],
  sampleRate: number,
  gain = 0.22,
  targetDurationSec?: number,
): Promise<void> {
  if (typeof window === "undefined" || sampleRate <= 0) return;
  let len = samples.length;
  if (len === 0 && (targetDurationSec == null || targetDurationSec <= 0)) return;
  if (targetDurationSec != null && targetDurationSec > 0) {
    const need = Math.ceil(targetDurationSec * sampleRate);
    len = Math.max(len, need);
  }
  if (len === 0) return;
  const ctx = ensurePreviewCtx();
  try {
    if (ctx.state === "suspended") await ctx.resume();
  } catch {
    /* ignore */
  }
  const buf = ctx.createBuffer(1, len, sampleRate);
  const ch = buf.getChannelData(0);
  ch.fill(0);
  for (let i = 0; i < samples.length; i++) ch[i] = samples[i] ?? 0;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(ctx.destination);
  src.start();
}
