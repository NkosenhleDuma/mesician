import { z } from "zod";
import { DEBUG_REPORT_VERSION } from "./debug-capture";

export const MAX_DEBUG_DECISIONS = 1000;

const verdictSchema = z.enum(["perfect", "slightEarly", "slightLate", "early", "late", "miss"]);

export const debugDecisionSchema = z.object({
  index: z.number().int(),
  songTimeSec: z.number(),
  audioContextTime: z.number().nullable(),
  outcome: z.enum(["accepted", "wrong-pitch", "timing-miss", "unmatched-onset", "missed-no-onset"]),
  latencyMsSetting: z.number(),
  verdict: verdictSchema.nullable(),
  timingErrorMs: z.number().nullable(),
  expectedEvent: z
    .object({
      id: z.string(),
      t0: z.number(),
      kind: z.string(),
      notes: z.array(
        z.object({
          string: z.number().int(),
          midi: z.number().int(),
          dead: z.boolean().optional(),
        }),
      ),
    })
    .nullable(),
  isPoly: z.boolean().nullable(),
  rms: z.number(),
  flux: z.number().nullable(),
  fluxThreshold: z.number().nullable(),
  candidates: z.array(z.object({ eventId: z.string(), deltaSec: z.number() })),
  trace: z
    .union([
      z.object({
        kind: z.literal("mono"),
        yinHz: z.number().nullable(),
        cmndfMin: z.number().nullable(),
        detectedMidi: z.number().nullable(),
        detectedHz: z.number().nullable(),
        centsPerNote: z.array(
          z.object({
            string: z.number().int(),
            midi: z.number().int(),
            cents: z.number().nullable(),
          }),
        ),
      }),
      z.object({
        kind: z.literal("poly"),
        detectedMidi: z.number().nullable(),
        detectedHz: z.number().nullable(),
        normEnergy: z.number(),
        supportThreshold: z.number(),
        perNote: z.array(
          z.object({
            string: z.number().int(),
            midi: z.number().int(),
            support: z.number(),
            pitchOk: z.boolean(),
          }),
        ),
      }),
      z.object({
        kind: z.literal("bp"),
        evidenceMidis: z.array(z.number()),
        dominantMidi: z.number().nullable(),
      }),
    ])
    .nullable(),
  spectrum: z.array(z.number()),
  waveSnippet: z.array(z.number()),
  detectedMidiGlob: z.number().nullable(),
  pitchTelemetry: z
    .object({
      tsMs: z.number(),
      avgInferMs: z.number(),
      p95InferMs: z.number(),
      avgDecodeMs: z.number(),
      avgResampleMs: z.number(),
      avgSchedulerLagMs: z.number(),
      inflight: z.number(),
      droppedWindowsTotal: z.number(),
      windowsPerSec: z.number(),
      rmsAvg: z.number(),
      activeNotesNow: z.number(),
      notesEmittedPerSec: z.number(),
      avgNoteOnLatencyMs: z.number(),
      p95NoteOnLatencyMs: z.number(),
    })
    .nullable()
    .optional(),
});

export const debugReportBodySchema = z.object({
  version: z.literal(DEBUG_REPORT_VERSION),
  meta: z.object({
    songId: z.string().uuid(),
    trackId: z.string().uuid(),
    runStartedAt: z.string(),
    latencyMs: z.number(),
    chartTuning: z.array(z.string()),
    capoFret: z.number().int().nullable(),
    capturedAtIso: z.string(),
    reason: z.enum(["manual", "run-complete", "pause", "exit"]).optional(),
    audioSampleRate: z.number().positive().finite().optional(),
  }),
  decisions: z.array(debugDecisionSchema).max(MAX_DEBUG_DECISIONS),
});

export type DebugReportBody = z.infer<typeof debugReportBodySchema>;
