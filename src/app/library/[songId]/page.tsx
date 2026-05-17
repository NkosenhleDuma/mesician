import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { practiceSessions, songs, songTracks } from "@/lib/db/schema";
import { GpUploadZone } from "@/components/library/GpUploadZone";
import { SongDangerZone } from "@/components/library/SongDangerZone";

type Props = { params: Promise<{ songId: string }> };

export default async function SongPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { songId } = await params;
  const db = getDb();
  const song = await db.query.songs.findFirst({
    where: and(eq(songs.id, songId), eq(songs.userId, session.sub)),
  });
  if (!song) notFound();

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

  return (
    <div className="space-y-8">
      <div>
        <Link href="/library" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Library
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-white">{song.title}</h1>
          <span className="rounded bg-emerald-900/50 px-2 py-1 text-xs font-medium text-emerald-200">
            L{song.difficulty}
          </span>
        </div>
        {song.artist && <p className="text-zinc-400">{song.artist}</p>}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-white">Tracks</h2>
        {tracks.length === 0 ? (
          <p className="text-zinc-500">Upload a file to extract tracks.</p>
        ) : (
          <ul className="space-y-2">
            {tracks.map((t) => {
              const empty = !t.hasNotes;
              const best = bestByTrack.get(t.id) ?? 0;
              return (
                <li
                  key={t.id}
                  className={`border border-zinc-800 rounded-lg p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${
                    empty ? "opacity-50 text-zinc-500" : ""
                  }`}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className={`font-medium ${empty ? "text-zinc-500" : "text-white"}`}>{t.name}</div>
                      <span className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
                        L{t.difficulty}
                      </span>
                      {best > 0 && (
                        <span className="rounded bg-sky-900/50 px-2 py-0.5 text-[11px] font-medium text-sky-200">
                          Best {best.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {t.isGuitar ? "Guitar-like" : "Other"} · index {t.trackIndex}
                      {empty ? " · no notes" : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/library/${songId}/tracks/${t.id}/edit`}
                      className="text-sm px-3 py-2 rounded-md bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    >
                      Edit tab
                    </Link>
                    <Link
                      href={`/library/${songId}/tracks/${t.id}/debug`}
                      className={`text-sm px-3 py-2 rounded-md bg-violet-900/40 text-violet-200 hover:bg-violet-800/55 ${empty ? "pointer-events-none opacity-50" : ""}`}
                    >
                      Debug
                    </Link>
                    <Link
                      href={`/practice/${t.id}`}
                      className={`text-sm px-3 py-2 rounded-md bg-emerald-900/50 text-emerald-200 hover:bg-emerald-800/60 ${empty ? "pointer-events-none opacity-50" : ""}`}
                    >
                      Practice
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {tracks.length === 0 ? (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-5 space-y-4">
          <div>
            <h2 className="text-lg font-medium text-white">Guitar Pro file</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Add or replace the tab for this song. Use <code className="text-zinc-400">.gp</code> (Guitar Pro 7/8),{" "}
              <code className="text-zinc-400">.gp3</code>, <code className="text-zinc-400">.gp4</code>,{" "}
              <code className="text-zinc-400">.gp5</code>, or <code className="text-zinc-400">.gpx</code> — drag onto
              the zone below or click to browse.
            </p>
          </div>
          <GpUploadZone songId={songId} />
        </section>
      ) : null}

      <SongDangerZone songId={songId} title={song.title} />
    </div>
  );
}
