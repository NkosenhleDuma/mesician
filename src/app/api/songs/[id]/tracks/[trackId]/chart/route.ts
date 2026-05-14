import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { songs, songTracks } from "@/lib/db/schema";
import { loadChartJson } from "@/lib/pipeline/reencode-track";

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
  if (!track?.sourceChartObjectKey) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const chart = await loadChartJson(track.sourceChartObjectKey);
  return NextResponse.json({ chart });
}
