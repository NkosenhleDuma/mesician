"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { ChartJson } from "@/lib/chart/types";
import type { StringProfile } from "@/lib/calibration/string-profile";
import { PracticeClient } from "./PracticeClient";
import { StringCalibrationFlow } from "./StringCalibrationFlow";

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
  const [phase, setPhase] = useState<"calibration" | "practice">("calibration");
  const [calibratedProfilePassThrough, setCalibratedProfilePassThrough] = useState<
    StringProfile | undefined
  >(undefined);

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

  const tuningOk = !!(chart?.meta && chart.meta.tuning.length === 6);

  useLayoutEffect(() => {
    if (!chart) return;
    setPhase(chart.meta.tuning.length === 6 ? "calibration" : "practice");
    setCalibratedProfilePassThrough(undefined);
  }, [chart, songId, trackId]);

  const onCalibrationFinished = useCallback(
    (result: { savedProfile: StringProfile | null; skippedCalibration: boolean }) => {
      setCalibratedProfilePassThrough(result.savedProfile ?? undefined);
      setPhase("practice");
    },
    [],
  );

  if (err) return <p className="text-red-400">{err}</p>;
  if (!chart) return <p className="text-zinc-400">Loading chart…</p>;

  return (
    <>
      {phase === "calibration" && tuningOk && (
        <StringCalibrationFlow
          sourceChart={chart}
          songTitle={songTitle}
          trackName={trackName}
          onFinished={onCalibrationFinished}
        />
      )}
      {phase === "practice" && (
        <PracticeClient
          chart={chart}
          songId={songId}
          trackId={trackId}
          songTitle={songTitle}
          trackName={trackName}
          calibratedProfilePassThrough={calibratedProfilePassThrough}
          skipMobileIntro
        />
      )}
    </>
  );
}
