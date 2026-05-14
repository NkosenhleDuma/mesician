import type { Soundfont } from "smplr";
import type { ChartJson } from "../chart/types";
import { resolveGuitarInstrument } from "./guitar-instrument";
import { scheduleChart } from "./synth-scheduler";

export type TransportState = {
  ctx: AudioContext;
  chart: ChartJson;
  /** Shared output bus for Soundfont + fallback synth. */
  outputGain: GainNode;
  /** Linear gain applied to `outputGain` (typical range 0–2). */
  playbackVolume: number;
  guitar: Soundfont | undefined;
  guitarLoadPromise: Promise<Soundfont | undefined> | undefined;
  /** After a failed load, stay on triangle synth for this transport lifetime. */
  guitarLoadError: boolean;
  scheduled: ReturnType<typeof scheduleChart>;
  playing: boolean;
  /** When playing: song time = playSongStart + (ctx.currentTime - playAudioStart) * playbackRate */
  playAudioStart: number;
  playSongStart: number;
  /** >1 = faster musical time vs wall clock */
  playbackRate: number;
  /**
   * While count-in runs, song clock may start at -countInLeadSec (getSongTime lower clamp).
   * Cleared on pause.
   */
  countInLeadSec: number;
};

export type CreateTransportOptions = {
  playbackVolume?: number;
};

export function createTransport(chart: ChartJson, opts?: CreateTransportOptions): TransportState {
  const AudioCtor =
    typeof window !== "undefined"
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!AudioCtor) {
    throw new Error("Web Audio API not available in this browser.");
  }
  const ctx = new AudioCtor();
  const outputGain = ctx.createGain();
  const playbackVolume = clampPlaybackVolume(opts?.playbackVolume ?? 1);
  outputGain.gain.value = playbackVolume;
  outputGain.connect(ctx.destination);
  return {
    ctx,
    chart,
    outputGain,
    playbackVolume,
    guitar: undefined,
    guitarLoadPromise: undefined,
    guitarLoadError: false,
    scheduled: [],
    playing: false,
    playAudioStart: 0,
    playSongStart: 0,
    playbackRate: 1,
    countInLeadSec: 0,
  };
}

function clampPlaybackVolume(v: number): number {
  const x = Number.isFinite(v) ? v : 1;
  return Math.min(2, Math.max(0, x));
}

/** Update master playback loudness; applies immediately (including during play). */
export function setPlaybackVolume(transport: TransportState, volume: number): void {
  const v = clampPlaybackVolume(volume);
  transport.playbackVolume = v;
  transport.outputGain.gain.value = v;
}

function stopAll(transport: TransportState) {
  for (const s of transport.scheduled) s.stop();
  transport.scheduled = [];
}

export function getSongTime(transport: TransportState): number {
  const { ctx, chart } = transport;
  if (!transport.playing) {
    return Math.max(0, Math.min(transport.playSongStart, chart.duration));
  }
  const rate = transport.playbackRate > 0 ? transport.playbackRate : 1;
  const song =
    transport.playSongStart + (ctx.currentTime - transport.playAudioStart) * rate;
  /** Negative `playSongStart` means chart clock started before beat 1 (count-in or reschedule mid count-in). */
  const lower = Math.min(0, transport.playSongStart);
  return Math.max(lower, Math.min(chart.duration, song));
}

export type PlayOptions = {
  /** Metronome beats before chart audio; only honored when starting at song time ~0. */
  countInBeats?: number;
  /** Downbeat click peak gain (others use ~70%). */
  countInGain?: number;
};

export async function play(transport: TransportState, opts?: PlayOptions): Promise<void> {
  const { ctx, chart, outputGain } = transport;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* tolerate */
    }
  }
  stopAll(transport);

  const from = getSongTime(transport);

  const beats = Math.max(0, Math.floor(opts?.countInBeats ?? 0));
  /** Count-in only when starting at the top of the chart (not mid-count-in negative time). */
  const wantCountIn = beats > 0 && from >= 0 && from <= 0.0001;

  const rate = transport.playbackRate > 0 ? transport.playbackRate : 1;
  const bpm = Math.max(20, chart.meta.tempoMap[0]?.bpm ?? 120);
  const secPerBeat = 60 / bpm / rate;
  const leadSec = wantCountIn ? beats * secPerBeat : 0;
  const startSong = wantCountIn ? -leadSec : from;

  const soundfont = await resolveGuitarInstrument(transport);
  const now = ctx.currentTime;
  transport.playing = true;
  transport.playAudioStart = now;
  transport.playSongStart = startSong;
  transport.countInLeadSec = startSong < 0 ? -startSong : 0;

  const stops = scheduleChart(
    ctx,
    chart,
    {
      startWhen: now,
      fromSec: startSong,
      gain: 0.07,
      speed: rate,
      outputGain,
    },
    soundfont,
  );

  if (wantCountIn) {
    const peak = opts?.countInGain ?? 0.18;
    const clickStops: typeof stops = [];
    for (let i = 0; i < beats; i++) {
      const t0 = now + i * secPerBeat;
      const isDown = i === 0;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = isDown ? 1000 : 750;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(outputGain);
      osc.start(t0);
      const v = isDown ? peak : peak * 0.7;
      g.gain.linearRampToValueAtTime(v, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      osc.stop(t0 + 0.11);
      clickStops.push({
        stop: () => {
          try {
            osc.stop();
          } catch {
            /* noop */
          }
        },
      });
    }
    transport.scheduled = [...clickStops, ...stops];
  } else {
    transport.scheduled = stops;
  }
}

export function pause(transport: TransportState) {
  if (transport.playing) {
    transport.playSongStart = Math.max(0, getSongTime(transport));
  }
  stopAll(transport);
  transport.playing = false;
  transport.countInLeadSec = 0;
}

export function seek(transport: TransportState, timeSec: number) {
  pause(transport);
  const d = transport.chart.duration || 0;
  transport.playSongStart = Math.max(0, Math.min(timeSec, d));
}
