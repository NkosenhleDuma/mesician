"use client";

import dynamic from "next/dynamic";

const NoteGameShell = dynamic(
  () =>
    import("@/components/exercises/note-selection/NoteGameShell").then(
      (m) => m.NoteGameShell,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-zinc-800 rounded w-48" />
        <div className="h-4 bg-zinc-800 rounded w-96" />
        <div className="h-64 bg-zinc-800 rounded" />
      </div>
    ),
  },
);

export function NoteGameShellLoader() {
  return <NoteGameShell />;
}
