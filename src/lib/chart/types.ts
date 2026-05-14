import { z } from "zod";

export const chartNoteSchema = z.object({
  string: z.number().int().min(1).max(6),
  fret: z.number().int().min(0),
  midi: z.number().int(),
  /** Guitar Pro / AlphaTab dead (“x”) note */
  dead: z.boolean().optional(),
  palmMute: z.boolean().optional(),
  vibrato: z.boolean().optional(),
});

export type ChartNote = z.infer<typeof chartNoteSchema>;

export const chartEventSchema = z.object({
  id: z.string(),
  t0: z.number(),
  t1: z.number(),
  kind: z.enum(["note", "chord"]),
  notes: z.array(chartNoteSchema),
  tech: z.array(z.string()).optional(),
  /** Paired event id for hammer-on / pull-off (mutual; lower t0 draws the combined pill) */
  hammerPullPeerId: z.string().optional(),
});

export type ChartEvent = z.infer<typeof chartEventSchema>;

export const chartMetaSchema = z.object({
  songTitle: z.string(),
  trackName: z.string(),
  tempoMap: z.array(z.object({ t: z.number(), bpm: z.number() })),
  timeSig: z.array(z.object({ t: z.number(), num: z.number(), den: z.number() })),
  tuning: z.array(z.string()),
  /** Guitar Pro capo fret; omit or 0 = no capo */
  capoFret: z.number().int().min(0).optional(),
  /** e.g. "G major" / "E minor" from import when available */
  key: z.string().optional(),
});

export type ChartMeta = z.infer<typeof chartMetaSchema>;

export const chartJsonSchema = z.object({
  version: z.literal(1),
  meta: chartMetaSchema,
  events: z.array(chartEventSchema),
  duration: z.number(),
});

export type ChartJson = z.infer<typeof chartJsonSchema>;

/** GP/AlphaTab may use negative fret for non-sounding strings in chords; coerce for Zod + UI. */
export function normalizeChartForParse(data: unknown): unknown {
  if (data === null || typeof data !== "object") return data;
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.events)) return data;
  return {
    ...o,
    events: o.events.map((ev) => {
      if (ev === null || typeof ev !== "object") return ev;
      const e = ev as Record<string, unknown>;
      if (!Array.isArray(e.notes)) return ev;
      return {
        ...e,
        notes: e.notes.map((note) => {
          if (note === null || typeof note !== "object") return note;
          const n = note as Record<string, unknown>;
          const fret = n.fret;
          if (typeof fret === "number" && fret < 0) {
            return { ...n, fret: 0, dead: true };
          }
          return note;
        }),
      };
    }),
  };
}

export function validateChartJson(data: unknown): ChartJson {
  return chartJsonSchema.parse(normalizeChartForParse(data));
}
