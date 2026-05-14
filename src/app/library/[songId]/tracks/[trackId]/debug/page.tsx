import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { DebugReportViewer } from "@/components/debug/DebugReportViewer";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { songs, songTracks } from "@/lib/db/schema";

type Props = {
  params: Promise<{ songId: string; trackId: string }>;
  searchParams: Promise<{ key?: string }>;
};

export default async function TrackDebugPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { songId, trackId } = await params;
  const q = await searchParams;
  const initialKey = typeof q.key === "string" && q.key.length > 0 ? q.key : undefined;

  const db = getDb();
  const song = await db.query.songs.findFirst({
    where: and(eq(songs.id, songId), eq(songs.userId, session.sub)),
  });
  if (!song) notFound();

  const track = await db.query.songTracks.findFirst({
    where: and(eq(songTracks.id, trackId), eq(songTracks.songId, songId)),
  });
  if (!track) notFound();

  return (
    <div className="space-y-6">
      <Link href={`/library/${songId}`} className="text-sm text-zinc-500 hover:text-zinc-300">
        ← Library · {song.title}
      </Link>
      <DebugReportViewer
        songId={songId}
        trackId={trackId}
        songTitle={song.title}
        trackName={track.name}
        initialKey={initialKey}
      />
    </div>
  );
}
