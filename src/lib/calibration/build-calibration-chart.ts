import type { ChartEvent, ChartJson, ChartMeta } from "@/lib/chart/types";
import { chartNoteMidi, sanitizeChart } from "@/lib/chart/note-midi";

const CAL_IDS = ["cal-s6", "cal-s5", "cal-s4", "cal-s3", "cal-s2", "cal-s1"] as const;

/** Spacing between open-string cues (seconds). */
const STEP_SEC = 0.55;
const NOTE_DUR = 0.4;

/** Build a scrolling-only calibration chart (6 mono open strings low→high). */
export function buildOpenStringCalibrationChart(source: ChartJson): ChartJson {
  const metaBase = source.meta;
  const meta: ChartMeta = {
    songTitle: metaBase.songTitle,
    trackName: metaBase.trackName,
    tempoMap: metaBase.tempoMap.length ? metaBase.tempoMap : [{ t: 0, bpm: 120 }],
    timeSig: metaBase.timeSig.length ? metaBase.timeSig : [{ t: 0, num: 4, den: 4 }],
    tuning: [...metaBase.tuning],
    ...(metaBase.capoFret != null && metaBase.capoFret > 0 ? { capoFret: metaBase.capoFret } : {}),
    ...(metaBase.key ? { key: metaBase.key } : {}),
  };

  const events: ChartEvent[] = [];

  if (meta.tuning.length !== 6) {
    return sanitizeChart({
      version: 1,
      meta,
      events,
      duration: 0,
    });
  }

  for (let i = 0; i < 6; i++) {
    const gpString = 6 - i;
    const m = chartNoteMidi(meta, gpString, 0);
    if (m == null) continue;
    const t0 = i * STEP_SEC;
    const t1 = t0 + NOTE_DUR;
    events.push({
      id: CAL_IDS[i]!,
      t0,
      t1,
      kind: "note",
      notes: [{ string: gpString, fret: 0, midi: m }],
    });
  }

  const raw: ChartJson = {
    version: 1,
    meta,
    events,
    duration: events.length === 0 ? 0 : Math.max(...events.map((e) => e.t1)),
  };

  return sanitizeChart(raw);
}

export function calibrationEventIds(): readonly string[] {
  return CAL_IDS;
}
