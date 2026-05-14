"use client";

import { useEffect, useState } from "react";
import type { ChartJson } from "@/lib/chart/types";
import { PracticeClient } from "./PracticeClient";

export function PracticeShell({
  songId,
  trackId,
  songTitle,
  trackName,
}: {
  songId: string;
  trackId: string;
  songTitle: string;
  trackName: string;
}) {
  const [chart, setChart] = useState<ChartJson | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/songs/${songId}/tracks/${trackId}/chart`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<{ chart: ChartJson }>;
      })
      .then((payload) => {
        if (!cancelled) {
          setChart(payload.chart);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [songId, trackId]);

  if (err) return <p className="text-red-400">{err}</p>;
  if (!chart) return <p className="text-zinc-400">Loading chart…</p>;

  return (
    <PracticeClient
      chart={chart}
      songId={songId}
      trackId={trackId}
      songTitle={songTitle}
      trackName={trackName}
    />
  );
}
