import type { Soundfont } from "smplr";
import type { ChartEvent, ChartJson, ChartNote } from "../chart/types";
import { midiToFreq } from "./midi-to-freq";

type Scheduled = { stop: () => void };

export type ScheduleChartOpts = {
  startWhen: number;
  fromSec?: number;
  gain?: number;
  speed?: number;
  /** Master bus for chart playback (shared with Soundfont). */
  outputGain: GainNode;
};

function palmMuted(ev: ChartEvent, n: ChartNote): boolean {
  return !!(n.palmMute || ev.tech?.includes("mute"));
}

function scheduleSamplerNotes(
  soundfont: Soundfont,
  chart: ChartJson,
  opts: ScheduleChartOpts,
): Scheduled[] {
  const from = opts.fromSec ?? 0;
  const speed = opts.speed ?? 1;
  const inv = speed > 0 ? 1 / speed : 1;
  const stops: Scheduled[] = [];

  for (const ev of chart.events) {
    if (ev.t1 <= from) continue;
    const rel0 = Math.max(0, ev.t0 - from) * inv;
    const rel1 = (ev.t1 - from) * inv;
    for (const n of ev.notes) {
      if (n.dead) continue;
      const t0 = opts.startWhen + rel0;
      const t1 = opts.startWhen + rel1;
      const rawDur = Math.max(0, t1 - t0);
      const muted = palmMuted(ev, n);
      const velocity = muted ? 58 : n.vibrato ? 92 : 88;
      const duration = muted
        ? Math.max(0.028, rawDur * 0.52)
        : Math.max(0.035, rawDur);
      const stopFn = soundfont.start({
        note: n.midi,
        time: t0,
        duration,
        velocity,
        detune: n.vibrato ? 4 : 0,
        lpfCutoffHz: muted ? 4200 : undefined,
        ampRelease: n.vibrato ? 0.32 : muted ? 0.06 : undefined,
      });
      stops.push({
        stop: () => {
          stopFn();
        },
      });
    }
  }
  return stops;
}

function scheduleTriangleNotes(
  ctx: AudioContext,
  chart: ChartJson,
  opts: ScheduleChartOpts,
): Scheduled[] {
  const gain = opts.gain ?? 0.08;
  const from = opts.fromSec ?? 0;
  const speed = opts.speed ?? 1;
  const inv = speed > 0 ? 1 / speed : 1;
  const master = ctx.createGain();
  master.gain.value = gain;
  master.connect(opts.outputGain);

  const stops: Scheduled[] = [];
  for (const ev of chart.events) {
    if (ev.t1 <= from) continue;
    const rel0 = Math.max(0, ev.t0 - from) * inv;
    const rel1 = (ev.t1 - from) * inv;
    for (const n of ev.notes) {
      if (n.dead) continue;
      const t0 = opts.startWhen + rel0;
      const t1 = opts.startWhen + rel1;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midiToFreq(n.midi);
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      const vel = palmMuted(ev, n) ? 0.35 : n.vibrato ? 0.52 : 0.55;
      g.gain.linearRampToValueAtTime(vel, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, Math.max(t0 + 0.02, t1));
      osc.stop(t1 + 0.03);
      stops.push({
        stop: () => {
          try {
            osc.stop();
          } catch {
            /* noop */
          }
        },
      });
    }
  }
  return stops;
}

/**
 * Schedule chart notes for playback. Uses sampled guitar when `soundfont` is provided,
 * otherwise the legacy triangle synth.
 */
export function scheduleChart(
  ctx: AudioContext,
  chart: ChartJson,
  opts: ScheduleChartOpts,
  soundfont?: Soundfont,
): Scheduled[] {
  if (soundfont) return scheduleSamplerNotes(soundfont, chart, opts);
  return scheduleTriangleNotes(ctx, chart, opts);
}
