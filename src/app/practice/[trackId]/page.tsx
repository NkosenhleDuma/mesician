import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { PracticeShell } from "@/components/practice/PracticeShell";
import { getDb } from "@/lib/db";
import { practiceSessions, songs, songTracks } from "@/lib/db/schema";

type Props = {
  params: Promise<{ trackId: string }>;
};

export default async function PracticePage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { trackId } = await params;
  const db = getDb();
  const track = await db.query.songTracks.findFirst({
    where: eq(songTracks.id, trackId),
  });
  if (!track) notFound();

  const song = await db.query.songs.findFirst({
    where: and(eq(songs.id, track.songId), eq(songs.userId, session.sub)),
  });
  if (!song) notFound();

  const [bestRow] = await db
    .select({
      bestScore: sql<number>`coalesce(max((${practiceSessions.scoreJson}->>'score')::int), 0)`,
    })
    .from(practiceSessions)
    .where(and(eq(practiceSessions.userId, session.sub), eq(practiceSessions.trackId, trackId)));

  const bestScore = Number(bestRow?.bestScore) || 0;

  return (
    <div className="space-y-4 landscape-hint">
      <Link href={`/library/${song.id}`} className="text-sm text-zinc-500 hover:text-zinc-300">
        ← Back to song
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-white">Practice · {track.name}</h1>
        <span className="rounded bg-emerald-900/50 px-2 py-1 text-xs font-medium text-emerald-200">
          L{track.difficulty}
        </span>
        {bestScore > 0 && (
          <span className="rounded bg-sky-900/50 px-2 py-1 text-xs font-medium text-sky-200">
            Best {bestScore.toLocaleString()}
          </span>
        )}
      </div>
      <PracticeShell
        songId={song.id}
        trackId={trackId}
        songTitle={song.title}
        trackName={track.name}
      />
    </div>
  );
}
