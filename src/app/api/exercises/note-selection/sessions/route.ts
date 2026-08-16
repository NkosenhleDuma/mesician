import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { noteGameSessions } from "@/lib/db/schema";
import type { NoteGameSessionResult } from "@/lib/exercises/note-selection/types";

const challengeResultSchema = z.object({
  challengeId: z.string(),
  targetPitchClass: z.number(),
  targetDisplayName: z.string(),
  mode: z.enum(["single-string", "region", "wide"]),
  selectedString: z.number().optional(),
  regionId: z.string().optional(),
  startedAt: z.number(),
  completedAt: z.number(),
  responseTimeMs: z.number().optional(),
  wrongAttempts: z.number(),
  result: z.enum(["correct", "timeout", "incomplete"]),
  scoreAwarded: z.number(),
  streakBefore: z.number(),
  streakAfter: z.number(),
});

const sessionConfigSchema = z.object({
  mode: z.enum(["single-string", "region", "wide"]),
  difficulty: z.enum(["beginner", "easy", "medium", "hard", "expert"]),
  accidentalMode: z.enum(["naturals", "all"]),
  fretboardLength: z.union([z.literal(12), z.literal(21)]),
  durationSec: z.union([z.literal(60), z.literal(180), z.literal(300), z.literal(600)]),
  regionId: z
    .enum(["lower-open", "low-mid", "middle", "upper-mid", "treble-strings", "bass-strings"])
    .optional(),
  revealDurationMs: z.number().optional(),
});

const sessionResultSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  config: sessionConfigSchema,
  score: z.number(),
  challengesPresented: z.number(),
  correct: z.number(),
  timeouts: z.number(),
  wrongNotes: z.number(),
  accuracy: z.number(),
  avgResponseTimeMs: z.number().nullable(),
  medianResponseTimeMs: z.number().nullable(),
  bestStreak: z.number(),
  scorePerMinute: z.number(),
  challengeResults: z.array(challengeResultSchema),
});

const postBodySchema = z.object({
  result: sessionResultSchema,
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const difficulty = url.searchParams.get("difficulty");
  const mode = url.searchParams.get("mode");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const db = getDb();
  const rows = await db
    .select()
    .from(noteGameSessions)
    .where(eq(noteGameSessions.userId, session.sub))
    .orderBy(desc(noteGameSessions.startedAt))
    .limit(200);

  const filtered = rows.filter((row) => {
    const config = row.config as NoteGameSessionResult["config"];
    if (difficulty && config.difficulty !== difficulty) return false;
    if (mode && config.mode !== mode) return false;
    if (from && row.startedAt < new Date(from)) return false;
    if (to && row.startedAt > new Date(to)) return false;
    return true;
  });

  return NextResponse.json({
    sessions: filtered.map((row) => ({
      id: row.id,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt.toISOString(),
      config: row.config,
      result: row.result,
    })),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = postBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { result } = parsed.data;
  const db = getDb();

  const [row] = await db
    .insert(noteGameSessions)
    .values({
      userId: session.sub,
      config: result.config,
      result,
      startedAt: new Date(result.startedAt),
      endedAt: new Date(result.endedAt),
    })
    .returning();

  return NextResponse.json({ session: row });
}
