"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  songId: string;
  title: string;
};

export function SongDangerZone({ songId, title }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"clear" | "delete" | null>(null);

  async function clearIngestion() {
    if (
      !confirm(
        "Remove all Guitar Pro data for this song? Uploads, tracks, and charts in storage will be deleted. The song title stays.",
      )
    ) {
      return;
    }
    setBusy("clear");
    try {
      const res = await fetch(`/api/songs/${songId}/ingestion`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  async function deleteSong() {
    if (
      !confirm(
        `Delete “${title}” permanently? The song and all uploads, charts, and practice history will be removed.`,
      )
    ) {
      return;
    }
    setBusy("delete");
    try {
      const res = await fetch(`/api/songs/${songId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.push("/library");
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 border-rose-900/40 bg-zinc-950/50 p-5 space-y-3">
      <h2 className="text-lg font-medium text-white">Danger zone</h2>
      <p className="text-sm text-zinc-500">
        Clear charts to upload a new file, or delete the entire song from your library.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void clearIngestion()}
          className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
        >
          {busy === "clear" ? "Removing…" : "Remove Guitar Pro data"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void deleteSong()}
          className="px-4 py-2 rounded-lg bg-rose-900/60 text-rose-100 hover:bg-rose-800/70 disabled:opacity-50 text-sm"
        >
          {busy === "delete" ? "Deleting…" : "Delete song"}
        </button>
      </div>
    </section>
  );
}
