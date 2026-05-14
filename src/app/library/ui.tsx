"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewSongForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, artist: artist || undefined }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { song: { id: string } };
    router.push(`/library/${data.song.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap gap-3 items-end p-4 rounded-lg border border-zinc-800 bg-zinc-950/50">
      <label className="space-y-1">
        <span className="text-xs text-zinc-500">Title</span>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-white min-w-[200px]"
        />
      </label>
      <label className="space-y-1">
        <span className="text-xs text-zinc-500">Artist (optional)</span>
        <input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          className="rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-white min-w-[180px]"
        />
      </label>
      <button type="submit" className="px-4 py-2 rounded-lg bg-zinc-700 text-white hover:bg-zinc-600">
        Create song
      </button>
    </form>
  );
}
