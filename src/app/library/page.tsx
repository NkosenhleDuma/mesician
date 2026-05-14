import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { songs } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { SongListRow } from "@/components/library/SongListRow";
import { NewSongForm } from "./ui";

export default async function LibraryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const db = getDb();
  const list = await db.query.songs.findMany({
    where: eq(songs.userId, session.sub),
    orderBy: [desc(songs.createdAt)],
  });

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-white">Your library</h1>
        <p className="text-sm text-zinc-500 max-w-xl">
          Create a song, then open it to <strong className="text-zinc-400 font-medium">upload a Guitar Pro file</strong>{" "}
          (<code className="text-zinc-500">.gp</code> / <code className="text-zinc-500">.gp3</code> /{" "}
          <code className="text-zinc-500">.gp4</code> / <code className="text-zinc-500">.gp5</code> /{" "}
          <code className="text-zinc-500">.gpx</code>) and practice.
        </p>
      </div>
      <NewSongForm />
      <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg overflow-hidden">
        {list.length === 0 && <li className="px-4 py-8 text-zinc-500">No songs yet. Create one and upload a GP file.</li>}
        {list.map((s) => (
          <SongListRow key={s.id} id={s.id} title={s.title} artist={s.artist} difficulty={s.difficulty} />
        ))}
      </ul>
    </div>
  );
}
