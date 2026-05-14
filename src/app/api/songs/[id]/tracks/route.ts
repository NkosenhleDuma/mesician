import { NextResponse } from "next/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { practiceSessions, songs, songTracks } from "@/lib/db/schema";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: songId } = await ctx.params;
  const db = getDb();
  const song = await db.query.songs.findFirst({
    where: and(eq(songs.id, songId), eq(songs.userId, session.sub)),
  });
  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tracks = await db.query.songTracks.findMany({
    where: eq(songTracks.songId, songId),
    orderBy: [asc(songTracks.trackIndex)],
  });

  const bestByTrack = new Map<string, number>();
  if (tracks.length > 0) {
    const ids = tracks.map((t) => t.id);
    const rows = await db
      .select({
        trackId: practiceSessions.trackId,
        bestScore: sql<number>`max((${practiceSessions.scoreJson}->>'score')::int)`,
      })
      .from(practiceSessions)
      .where(and(eq(practiceSessions.userId, session.sub), inArray(practiceSessions.trackId, ids)))
      .groupBy(practiceSessions.trackId);
    for (const r of rows) {
      bestByTrack.set(r.trackId, Number(r.bestScore) || 0);
    }
  }

  return NextResponse.json({
    tracks: tracks.map((t) => ({
      ...t,
      bestScore: bestByTrack.get(t.id) ?? 0,
    })),
  });
}
