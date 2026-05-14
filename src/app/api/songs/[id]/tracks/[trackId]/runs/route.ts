import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { practiceSessions, songs, songTracks } from "@/lib/db/schema";

const postBodySchema = z.object({
  score: z.number().int().nonnegative(),
  maxMultiplier: z.number().int().min(1).max(5),
  completionPct: z.number().min(0).max(1),
  counts: z.object({
    perfect: z.number().int().nonnegative(),
    slight: z.number().int().nonnegative(),
    off: z.number().int().nonnegative(),
    miss: z.number().int().nonnegative(),
  }),
  durationSec: z.number().nonnegative(),
  source: z.enum(["mic", "emulate"]),
  startedAt: z.string().optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; trackId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: songId, trackId } = await ctx.params;
  const db = getDb();
  const song = await db.query.songs.findFirst({
    where: and(eq(songs.id, songId), eq(songs.userId, session.sub)),
  });
  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const track = await db.query.songTracks.findFirst({
    where: and(eq(songTracks.id, trackId), eq(songTracks.songId, songId)),
  });
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });

  const [bestRow] = await db
    .select({
      bestScore: sql<number>`coalesce(max((${practiceSessions.scoreJson}->>'score')::int), 0)`,
    })
    .from(practiceSessions)
    .where(and(eq(practiceSessions.userId, session.sub), eq(practiceSessions.trackId, trackId)));

  const attempts = await db
    .select()
    .from(practiceSessions)
    .where(and(eq(practiceSessions.userId, session.sub), eq(practiceSessions.trackId, trackId)))
    .orderBy(desc(practiceSessions.startedAt))
    .limit(20);

  return NextResponse.json({
    bestScore: Number(bestRow?.bestScore) || 0,
    attempts: attempts.map((a) => ({
      id: a.id,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      scoreJson: a.scoreJson,
    })),
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string; trackId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: songId, trackId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = postBodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const db = getDb();
  const song = await db.query.songs.findFirst({
    where: and(eq(songs.id, songId), eq(songs.userId, session.sub)),
  });
  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const track = await db.query.songTracks.findFirst({
    where: and(eq(songTracks.id, trackId), eq(songTracks.songId, songId)),
  });
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });

  const startedAt = parsed.data.startedAt ? new Date(parsed.data.startedAt) : new Date();
  const scoreJson = { ...parsed.data };

  const [row] = await db
    .insert(practiceSessions)
    .values({
      userId: session.sub,
      trackId,
      startedAt,
      endedAt: new Date(),
      scoreJson,
    })
    .returning();

  return NextResponse.json({ session: row });
}
