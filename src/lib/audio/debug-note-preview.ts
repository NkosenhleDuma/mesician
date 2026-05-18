import { midiToFreq } from "@/lib/audio/midi-to-freq";

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

/** Short sine previews for debug / calibration (not chart-quality). */
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

export async function playFloatSnippet(
  samples: readonly number[],
  sampleRate: number,
  gain = 0.22,
): Promise<void> {
  if (typeof window === "undefined" || samples.length === 0 || sampleRate <= 0) return;
  const ctx = ensurePreviewCtx();
  try {
    if (ctx.state === "suspended") await ctx.resume();
  } catch {
    /* ignore */
  }
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) ch[i] = samples[i] ?? 0;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(ctx.destination);
  src.start();
}
