"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ChartJson } from "@/lib/chart/types";

export default function EditTabPage() {
  const { songId, trackId } = useParams<{ songId: string; trackId: string }>();
  const router = useRouter();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/songs/${songId}/tracks/${trackId}/chart-source`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<{ chart: ChartJson }>;
      })
      .then((data) => {
        if (!cancelled) {
          setText(JSON.stringify(data.chart, null, 2));
          setLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setErr(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [songId, trackId]);

  async function save() {
    setErr(null);
    let chart: ChartJson;
    try {
      chart = JSON.parse(text) as ChartJson;
    } catch {
      setErr("Invalid JSON");
      return;
    }
    const res = await fetch(`/api/songs/${songId}/tracks/${trackId}/chart-source`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chart),
    });
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    router.push(`/library/${songId}`);
    router.refresh();
  }

  if (loading) return <p className="text-zinc-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={`/library/${songId}`} className="text-sm text-zinc-500">
          ← Back to song
        </Link>
        <Link
          href={`/library/${songId}/tracks/${trackId}/debug`}
          className="text-sm text-violet-400 hover:text-violet-300"
        >
          Mic debug reports
        </Link>
      </div>
      <h1 className="text-xl font-semibold text-white">Edit tab (JSON)</h1>
      <p className="text-sm text-zinc-500 max-w-2xl">
        Edit the chart events (times in seconds, strings 1–6). Saving stores your version merged with the original import
        and recomputes difficulty.
      </p>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full min-h-[420px] font-mono text-sm bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-200"
        spellCheck={false}
      />
      <button type="button" onClick={save} className="px-4 py-2 rounded-lg bg-emerald-600 text-white">
        Save & recompute difficulty
      </button>
    </div>
  );
}
