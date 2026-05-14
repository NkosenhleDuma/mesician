"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  id: string;
  title: string;
  artist: string | null;
  difficulty: number;
};

export function SongListRow({ id, title, artist, difficulty }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function deleteSong() {
    if (
      !confirm(
        `Delete “${title}” permanently? All Guitar Pro uploads, charts, and practice data for this song will be removed.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/songs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-stretch divide-x divide-zinc-800">
      <Link href={`/library/${id}`} className="flex-1 block px-4 py-3 hover:bg-zinc-900/80 text-zinc-200 min-w-0">
        <span className="inline-flex items-center gap-2">
          <span className="font-medium text-white">{title}</span>
          <span className="rounded bg-emerald-900/50 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
            L{difficulty}
          </span>
        </span>
        {artist && <span className="text-zinc-500"> — {artist}</span>}
        <span className="block text-xs text-zinc-600 mt-1">Open to upload or re-upload GP · practice by track</span>
      </Link>
      <button
        type="button"
        disabled={busy}
        onClick={() => void deleteSong()}
        className="shrink-0 px-3 py-3 text-sm text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 disabled:opacity-50 min-w-[4.5rem]"
      >
        {busy ? "…" : "Delete"}
      </button>
    </li>
  );
}
