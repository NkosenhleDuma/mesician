"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { debugReportBodySchema, type DebugReportBody } from "@/lib/scoring/debug-report-schema";
import {
  MONO_CENTS_TOLERANCE,
  POLY_SUPPORT_THRESHOLD,
  YIN_CMNDF_MAX,
  type OnsetRecognizerTuning,
} from "@/lib/scoring/recognize";
import { VERDICT_WINDOWS_MS } from "@/lib/scoring/engine";
import {
  isReplayableDecision,
  REPLAY_SAMPLE_RATE_FALLBACK,
  replayDecisionOutcome,
} from "@/lib/scoring/debug-replay";

type Props = {
  songId: string;
  trackId: string;
  songTitle: string;
  trackName: string;
  initialKey?: string;
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

function midiLabel(m: number): string {
  const mi = Math.round(m);
  const octave = Math.floor(mi / 12) - 1;
  const name = NOTE_NAMES[((mi % 12) + 12) % 12]!;
  return `${name}${octave}`;
}

function outcomeBadgeClass(outcome: string): string {
  switch (outcome) {
    case "accepted":
      return "bg-emerald-900/50 text-emerald-200 ring-1 ring-emerald-800";
    case "wrong-pitch":
      return "bg-amber-900/50 text-amber-100 ring-1 ring-amber-800";
    case "timing-miss":
      return "bg-orange-900/50 text-orange-100 ring-1 ring-orange-800";
    case "unmatched-onset":
      return "bg-zinc-800 text-zinc-200 ring-1 ring-zinc-600";
    case "missed-no-onset":
      return "bg-red-950/60 text-red-200 ring-1 ring-red-900";
    default:
      return "bg-zinc-800 text-zinc-300";
  }
}

export function DebugReportViewer({ songId, trackId, songTitle, trackName, initialKey }: Props) {
  const [items, setItems] = useState<Array<{ key: string; lastModified: string | null }>>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [report, setReport] = useState<DebugReportBody | null>(null);
  const [reportErr, setReportErr] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const [latencyMs, setLatencyMs] = useState(0);
  const [winPerfect, setWinPerfect] = useState<number>(VERDICT_WINDOWS_MS.perfect);
  const [winSlight, setWinSlight] = useState<number>(VERDICT_WINDOWS_MS.slight);
  const [winOff, setWinOff] = useState<number>(VERDICT_WINDOWS_MS.off);
  const [monoCents, setMonoCents] = useState<number>(MONO_CENTS_TOLERANCE);
  const [polySupport, setPolySupport] = useState<number>(POLY_SUPPORT_THRESHOLD);
  const [yinCmndf, setYinCmndf] = useState<number>(YIN_CMNDF_MAX);

  const tuning: OnsetRecognizerTuning = useMemo(
    () => ({
      timingWindows: { perfect: winPerfect, slight: winSlight, off: winOff },
      monoCentsTolerance: monoCents,
      polySupportThreshold: polySupport,
      yinCmndfMax: yinCmndf,
    }),
    [winPerfect, winSlight, winOff, monoCents, polySupport, yinCmndf],
  );

  const listItems = useMemo(() => {
    if (!selectedKey) return items;
    if (items.some((x) => x.key === selectedKey)) return items;
    return [{ key: selectedKey, lastModified: null }, ...items];
  }, [items, selectedKey]);

  useEffect(() => {
    let c = false;
    setListLoading(true);
    setListErr(null);
    fetch(`/api/debug/note-decisions?trackId=${encodeURIComponent(trackId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text().catch(() => r.statusText));
        return r.json() as Promise<{ items: typeof items }>;
      })
      .then((data) => {
        if (c) return;
        setItems(data.items ?? []);
      })
      .catch((e: Error) => {
        if (!c) setListErr(e.message);
      })
      .finally(() => {
        if (!c) setListLoading(false);
      });
    return () => {
      c = true;
    };
  }, [trackId]);

  const loadReport = useCallback(async (key: string) => {
    setReportLoading(true);
    setReportErr(null);
    setReport(null);
    try {
      const r = await fetch(`/api/debug/note-decisions?key=${encodeURIComponent(key)}`);
      if (!r.ok) throw new Error(await r.text().catch(() => r.statusText));
      const json: unknown = await r.json();
      const parsed = debugReportBodySchema.safeParse(json);
      if (!parsed.success) throw new Error("Report failed validation");
      setReport(parsed.data);
      setLatencyMs(parsed.data.meta.latencyMs);
      setWinPerfect(VERDICT_WINDOWS_MS.perfect);
      setWinSlight(VERDICT_WINDOWS_MS.slight);
      setWinOff(VERDICT_WINDOWS_MS.off);
      setMonoCents(MONO_CENTS_TOLERANCE);
      setPolySupport(POLY_SUPPORT_THRESHOLD);
      setYinCmndf(YIN_CMNDF_MAX);
    } catch (e) {
      setReportErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialKey) return;
    setSelectedKey(initialKey);
    void loadReport(initialKey);
  }, [initialKey, loadReport]);

  const replayStats = useMemo(() => {
    if (!report) return { total: 0, diff: 0 };
    let total = 0;
    let diff = 0;
    for (const d of report.decisions) {
      if (!isReplayableDecision(d)) continue;
      const replayed = replayDecisionOutcome(d, report.meta, latencyMs, tuning);
      if (replayed == null) continue;
      total += 1;
      if (replayed !== d.outcome) diff += 1;
    }
    return { total, diff };
  }, [report, latencyMs, tuning]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Mic debug · {trackName}</h1>
          <p className="text-sm text-zinc-500">
            {songTitle} — reports saved from practice (mic, debug capture on).
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link href={`/library/${songId}`} className="text-sm text-zinc-400 hover:text-zinc-200">
            Song
          </Link>
          <Link href={`/practice/${trackId}`} className="text-sm text-sky-400 hover:text-sky-300">
            Practice
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Report
          <select
            className="min-w-[280px] rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            value={selectedKey ?? ""}
            disabled={listLoading}
            onChange={(e) => {
              const k = e.target.value || null;
              setSelectedKey(k);
              if (k) void loadReport(k);
              else {
                setReport(null);
                setReportErr(null);
              }
            }}
          >
            <option value="">
              {listLoading ? "Loading…" : listItems.length === 0 ? "No reports yet" : "Choose a report…"}
            </option>
            {listItems.map((it) => (
              <option key={it.key} value={it.key}>
                {it.key.split("/").pop()} {it.lastModified ? `· ${it.lastModified.slice(0, 19)}` : ""}
              </option>
            ))}
          </select>
        </label>
        {reportLoading && <span className="text-sm text-zinc-500">Loading report…</span>}
      </div>
      {listErr && <p className="text-sm text-red-400">{listErr}</p>}
      {reportErr && <p className="text-sm text-red-400">{reportErr}</p>}

      {report && (
        <>
          {!report.meta.audioSampleRate && (
            <p className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
              This report has no <code className="text-amber-200">audioSampleRate</code> — replay assumes{" "}
              {REPLAY_SAMPLE_RATE_FALLBACK} Hz (legacy blob). Record a new capture for accurate replay.
            </p>
          )}

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 text-sm text-zinc-400">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                Reason:{" "}
                <span className="text-zinc-200">{report.meta.reason ?? "legacy"}</span>
              </span>
              <span>
                Captured:{" "}
                <span className="text-zinc-200">{report.meta.capturedAtIso}</span>
              </span>
              <span>
                Latency stored:{" "}
                <span className="text-zinc-200">{report.meta.latencyMs} ms</span>
              </span>
              {report.meta.audioSampleRate != null && (
                <span>
                  Sample rate:{" "}
                  <span className="text-zinc-200">{report.meta.audioSampleRate} Hz</span>
                </span>
              )}
            </div>
            <p className="mt-2 text-zinc-500">
              Replay differs on {replayStats.diff} / {replayStats.total} onset rows (tuning sliders below).
            </p>
          </div>

          <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
            <h2 className="text-sm font-medium text-white">Replay tuning</h2>
            <p className="text-xs text-zinc-500">
              Re-runs recognition on captured spectrum/audio snippets only — not onset detection / flux.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Dial
                label="Input latency (ms)"
                min={-400}
                max={400}
                step={5}
                value={latencyMs}
                onChange={setLatencyMs}
              />
              <Dial label="Perfect window (ms)" min={15} max={80} step={1} value={winPerfect} onChange={setWinPerfect} />
              <Dial label="Slight window (ms)" min={40} max={120} step={1} value={winSlight} onChange={setWinSlight} />
              <Dial label="Off window (ms)" min={90} max={280} step={5} value={winOff} onChange={setWinOff} />
              <Dial label="Mono cents ±" min={15} max={120} step={1} value={monoCents} onChange={setMonoCents} />
              <Dial
                label="Poly support min"
                min={0.05}
                max={0.45}
                step={0.01}
                value={polySupport}
                onChange={setPolySupport}
              />
              <Dial label="YIN CMNDF max" min={0.05} max={0.45} step={0.01} value={yinCmndf} onChange={setYinCmndf} />
            </div>
          </section>

          <div className="max-h-[min(68vh,720px)] space-y-3 overflow-y-auto pr-1">
            {report.decisions.map((d) => (
              <DecisionCard
                key={`${selectedKey}-${d.index}`}
                decision={d}
                meta={report.meta}
                latencyMs={latencyMs}
                tuning={tuning}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Dial({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-400">
      <span className="flex justify-between text-zinc-300">
        {label}
        <span className="font-mono text-zinc-100">{step < 1 ? value.toFixed(2) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        className="w-full accent-sky-500"
      />
    </label>
  );
}

function DecisionCard({
  decision: d,
  meta,
  latencyMs,
  tuning,
}: {
  decision: DebugReportBody["decisions"][number];
  meta: DebugReportBody["meta"];
  latencyMs: number;
  tuning: OnsetRecognizerTuning;
}) {
  const replayed = useMemo(() => {
    if (!isReplayableDecision(d)) return null;
    return replayDecisionOutcome(d, meta, latencyMs, tuning);
  }, [d, meta, latencyMs, tuning]);

  const mismatch = replayed != null && replayed !== d.outcome;

  return (
    <article
      className={`rounded-lg border p-4 text-sm ${
        mismatch ? "border-sky-800/80 bg-sky-950/20" : "border-zinc-800 bg-zinc-950/50"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-zinc-500">#{d.index}</span>
        <span className="font-mono text-zinc-200">{d.songTimeSec.toFixed(3)}s</span>
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${outcomeBadgeClass(d.outcome)}`}>
          {d.outcome.replace(/-/g, " ")}
        </span>
        {d.verdict && <span className="text-xs text-zinc-400">{d.verdict}</span>}
        {d.timingErrorMs != null && (
          <span className="text-xs text-zinc-500">
            Δt {d.timingErrorMs >= 0 ? "+" : ""}
            {d.timingErrorMs.toFixed(0)} ms
          </span>
        )}
        <span className="text-xs text-zinc-500">latency@{d.latencyMsSetting}ms</span>
      </div>

      {replayed != null && (
        <div className="mt-2 text-xs">
          <span className="text-zinc-500">Replay:</span>{" "}
          <span className={`rounded px-1.5 py-0.5 font-medium ${outcomeBadgeClass(replayed)}`}>
            {replayed.replace(/-/g, " ")}
          </span>
        </div>
      )}
      {replayed === null && !isReplayableDecision(d) && (
        <p className="mt-2 text-xs text-zinc-500">Replay unavailable (missing expected event or buffers).</p>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Expected</div>
          {d.expectedEvent ? (
            <div className="space-y-1 font-mono text-xs text-zinc-300">
              <div>t0={d.expectedEvent.t0.toFixed(3)}s · {d.expectedEvent.kind}</div>
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="py-0.5 pr-2 font-normal">Str</th>
                    <th className="py-0.5 pr-2 font-normal">MIDI</th>
                    <th className="py-0.5 font-normal">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {d.expectedEvent.notes.map((n, idx) => (
                    <tr key={`${idx}-${n.string}-${n.midi}`}>
                      <td className="py-0.5 pr-2">{n.string}</td>
                      <td className="py-0.5 pr-2">{n.midi}</td>
                      <td className="py-0.5">
                        {midiLabel(n.midi)}
                        {n.dead ? " (dead)" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-zinc-600">None</p>
          )}
        </div>

        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Detected</div>
          {d.detectedMidiGlob != null && (
            <p className="font-mono text-xs text-zinc-300">
              Global MIDI {d.detectedMidiGlob.toFixed(2)} ({midiLabel(d.detectedMidiGlob)})
            </p>
          )}
          {d.trace?.kind === "mono" && (
            <ul className="mt-1 space-y-0.5 text-xs text-zinc-400">
              <li>YIN Hz: {d.trace.yinHz?.toFixed(2) ?? "—"}</li>
              <li>cmndf min: {d.trace.cmndfMin?.toFixed(4) ?? "—"}</li>
              {d.trace.centsPerNote.map((c, idx) => (
                <li key={`${idx}-${c.string}-${c.midi}`}>
                  str {c.string}: {c.cents != null ? `${c.cents.toFixed(1)} cents` : "—"}
                </li>
              ))}
            </ul>
          )}
          {d.trace?.kind === "poly" && (
            <ul className="mt-1 space-y-1 text-xs">
              <li className="text-zinc-500">
                normEnergy {d.trace.normEnergy.toFixed(4)} · threshold {d.trace.supportThreshold.toFixed(2)}
              </li>
              {d.trace.perNote.map((p, idx) => (
                <li key={`${idx}-${p.string}-${p.midi}`} className="flex justify-between gap-2 text-zinc-300">
                  <span>
                    str{p.string} midi {p.midi} ({midiLabel(p.midi)})
                  </span>
                  <span className={p.pitchOk ? "text-emerald-400" : "text-amber-300"}>
                    sup {p.support.toFixed(3)} {p.pitchOk ? "ok" : "×"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!d.trace && <p className="text-xs text-zinc-600">No trace</p>}
        </div>
      </div>

      <details className="mt-3 text-xs text-zinc-500">
        <summary className="cursor-pointer text-zinc-400 hover:text-zinc-300">Flux & candidates</summary>
        <div className="mt-2 space-y-1 pl-2">
          <div>
            flux {d.flux?.toFixed(6) ?? "—"} / thresh {d.fluxThreshold?.toFixed(6) ?? "—"}
          </div>
          <div>RMS {d.rms.toFixed(5)}</div>
          <ul>
            {d.candidates.map((c) => (
              <li key={c.eventId}>
                {c.eventId} Δ {c.deltaSec.toFixed(4)}s
              </li>
            ))}
          </ul>
        </div>
      </details>
    </article>
  );
}
