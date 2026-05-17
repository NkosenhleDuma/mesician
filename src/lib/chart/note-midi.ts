import { effectiveOpenStringMidi } from "@/lib/scoring/pitch";
import type { ChartEvent, ChartJson, ChartMeta, ChartNote } from "./types";

/** Sounding MIDI from chart meta + GP string + fret (matches import / scoring expectations). */
export function chartNoteMidi(meta: ChartMeta, gpString: number, fret: number): number | null {
  const open = effectiveOpenStringMidi(meta.tuning, gpString, meta.capoFret ?? null);
  if (open == null) return null;
  return open + Math.max(0, fret);
}

export function syncNoteMidi(note: ChartNote, meta: ChartMeta): ChartNote {
  const m = chartNoteMidi(meta, note.string, note.fret);
  if (m == null) return note;
  return { ...note, midi: m };
}

export function syncEventMidis(ev: ChartEvent, meta: ChartMeta): ChartEvent {
  return {
    ...ev,
    notes: ev.notes.map((n) => syncNoteMidi(n, meta)),
  };
}

/** Sort by t0, sync `kind` from note count, recompute midis, set duration from last t1. */
export function sanitizeChart(chart: ChartJson): ChartJson {
  const sorted = [...chart.events].sort((a, b) => a.t0 - b.t0);
  const events = sorted.map((ev) =>
    syncEventMidis(
      {
        ...ev,
        kind: ev.notes.length > 1 ? "chord" : "note",
      },
      chart.meta,
    ),
  );
  const duration = events.length === 0 ? 0 : Math.max(0, ...events.map((e) => e.t1));
  return { ...chart, events, duration };
}

export function removeEventAndFixPeers(events: ChartEvent[], removedId: string): ChartEvent[] {
  return events
    .filter((e) => e.id !== removedId)
    .map((e) =>
      e.hammerPullPeerId === removedId ? { ...e, hammerPullPeerId: undefined } : e,
    );
}
