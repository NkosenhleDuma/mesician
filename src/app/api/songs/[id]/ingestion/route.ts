import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { songTracks, songUploads, songs } from "@/lib/db/schema";
import { purgeSongStorage } from "@/lib/s3/client";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: songId } = await ctx.params;
  const db = getDb();
  const song = await db.query.songs.findFirst({
    where: and(eq(songs.id, songId), eq(songs.userId, session.sub)),
  });
  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await purgeSongStorage(songId);
  await db.delete(songTracks).where(eq(songTracks.songId, songId));
  await db.delete(songUploads).where(eq(songUploads.songId, songId));
  await db.update(songs).set({ difficulty: 1 }).where(eq(songs.id, songId));
  return NextResponse.json({ ok: true });
}
