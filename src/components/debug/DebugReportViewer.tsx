"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debugReportBodySchema, type DebugReportBody } from "@/lib/scoring/debug-report-schema";
import {
  MONO_CENTS_TOLERANCE,
  POLY_SUPPORT_THRESHOLD,
  YIN_CMNDF_MAX,
  evidenceMidiMatchesExpected,
  type OnsetRecognizerTuning,
} from "@/lib/scoring/recognize";
import { playFloatSnippet, playMidiPreview } from "@/lib/audio/debug-note-preview";
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

function expectedMidisNonDead(
  ev: DebugReportBody["decisions"][number]["expectedEvent"],
): number[] {
  if (!ev) return [];
  return ev.notes.filter((n) => !n.dead).map((n) => n.midi);
}

function detectedMidisForPreview(d: DebugReportBody["decisions"][number]): number[] {
  if (d.trace?.kind === "bp") return [...d.trace.evidenceMidis];
  if (d.trace?.kind === "poly") return d.trace.perNote.map((p) => p.midi);
  if (d.trace?.kind === "mono" && d.trace.detectedMidi != null) return [Math.round(d.trace.detectedMidi)];
  if (d.detectedMidiGlob != null) return [Math.round(d.detectedMidiGlob)];
  return [];
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
  const sessionAudioRef = useRef<HTMLAudioElement | null>(null);

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

  const reportTelemetrySummary = useMemo(() => {
    if (!report) return null;
    for (let i = report.decisions.length - 1; i >= 0; i--) {
      const t = report.decisions[i]!.pitchTelemetry;
      if (t) return t;
    }
    return null;
  }, [report]);

  const seekSessionAudio = useCallback((songTimeSec: number) => {
    const el = sessionAudioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, songTimeSec);
    void el.play().catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Practice debug · {trackName}</h1>
          <p className="text-sm text-zinc-500">
            {songTitle} — mic / file captures with debug enabled from practice.
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
              {report.meta.audioRecordingMime != null && (
                <span>
                  Recording: <span className="text-zinc-200">{report.meta.audioRecordingMime}</span>
                </span>
              )}
            </div>
            <p className="mt-2 text-zinc-500">
              Replay differs on {replayStats.diff} / {replayStats.total} onset rows (tuning sliders below).
            </p>
          </div>

          {report.meta.audioRecordingKey ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
              <h2 className="text-sm font-medium text-white">Session audio</h2>
              <p className="text-xs text-zinc-500">
                Recorded alongside this report. Use &quot;Play at song time&quot; on a row to seek.
              </p>
              <audio
                ref={sessionAudioRef}
                controls
                className="w-full max-w-xl"
                src={`/api/debug/session-audio?key=${encodeURIComponent(report.meta.audioRecordingKey)}`}
              />
            </div>
          ) : null}

          {reportTelemetrySummary ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
              <h2 className="text-sm font-medium text-white">Run Basic Pitch metrics (latest snapshot)</h2>
              <TelemetryGrid t={reportTelemetrySummary} />
            </div>
          ) : null}

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
                onSeekSessionAudio={report.meta.audioRecordingKey ? seekSessionAudio : undefined}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TelemetryGrid({
  t,
}: {
  t: NonNullable<DebugReportBody["decisions"][number]["pitchTelemetry"]>;
}) {
  return (
    <div className="mt-2 grid gap-1 font-mono text-[11px] text-zinc-400 sm:grid-cols-2 lg:grid-cols-3">
      <div>ts {t.tsMs.toFixed(0)} ms</div>
      <div>infer avg {t.avgInferMs.toFixed(2)} ms</div>
      <div>p95 infer {t.p95InferMs.toFixed(2)} ms</div>
      <div>decode avg {t.avgDecodeMs.toFixed(2)} ms</div>
      <div>resample avg {t.avgResampleMs.toFixed(2)} ms</div>
      <div>sched lag avg {t.avgSchedulerLagMs.toFixed(2)} ms</div>
      <div>inflight {t.inflight}</div>
      <div>dropped wins {t.droppedWindowsTotal}</div>
      <div>windows/s {t.windowsPerSec.toFixed(2)}</div>
      <div>rms avg {t.rmsAvg.toFixed(5)}</div>
      <div>active notes {t.activeNotesNow}</div>
      <div>notes/s {t.notesEmittedPerSec.toFixed(2)}</div>
      <div>note-on avg {t.avgNoteOnLatencyMs.toFixed(2)} ms</div>
      <div>note-on p95 {t.p95NoteOnLatencyMs.toFixed(2)} ms</div>
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
  onSeekSessionAudio,
}: {
  decision: DebugReportBody["decisions"][number];
  meta: DebugReportBody["meta"];
  latencyMs: number;
  tuning: OnsetRecognizerTuning;
  onSeekSessionAudio?: (songTimeSec: number) => void;
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
        {onSeekSessionAudio && (
          <button
            type="button"
            className="text-[11px] text-sky-400 hover:text-sky-300"
            onClick={() => onSeekSessionAudio(d.songTimeSec)}
          >
            Play at song time
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
          disabled={expectedMidisNonDead(d.expectedEvent).length === 0}
          onClick={() => void playMidiPreview(expectedMidisNonDead(d.expectedEvent))}
        >
          Play expected
        </button>
        <button
          type="button"
          className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
          disabled={detectedMidisForPreview(d).length === 0}
          onClick={() => void playMidiPreview(detectedMidisForPreview(d))}
        >
          Play detected
        </button>
        <button
          type="button"
          className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
          disabled={d.waveSnippet.length === 0}
          onClick={() =>
            void playFloatSnippet(d.waveSnippet, meta.audioSampleRate ?? REPLAY_SAMPLE_RATE_FALLBACK)
          }
        >
          Play snippet
        </button>
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
          {d.trace?.kind === "bp" && (
            <div className="mt-1 space-y-1 text-xs text-zinc-400">
              <p className="text-zinc-500">
                Basic Pitch evidence · dominant {d.trace.dominantMidi != null ? d.trace.dominantMidi : "—"}
              </p>
              <div className="flex flex-wrap gap-1">
                {d.trace.evidenceMidis.length === 0 ? (
                  <span className="text-zinc-600">—</span>
                ) : (
                  d.trace.evidenceMidis.map((m) => {
                    const exp = expectedMidisNonDead(d.expectedEvent);
                    const neutral = exp.length === 0;
                    const matched = !neutral && evidenceMidiMatchesExpected(m, exp);
                    return (
                      <span
                        key={`e-${m}`}
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] ring-1 ${
                          neutral
                            ? "bg-zinc-800 text-zinc-200 ring-zinc-700"
                            : matched
                              ? "bg-emerald-950/60 text-emerald-200 ring-emerald-900"
                              : "bg-amber-950/60 text-amber-100 ring-amber-900"
                        }`}
                        title={
                          neutral
                            ? "no expected chord to compare"
                            : matched
                              ? "matches expected (±0.55 semitone)"
                              : "extra vs expected chart MIDIs"
                        }
                      >
                        {midiLabel(m)} ({m})
                      </span>
                    );
                  })
                )}
              </div>
              {d.trace.stabilizerDroppedMidis != null && d.trace.stabilizerDroppedMidis.length > 0 && (
                <div className="mt-1">
                  <p className="text-[10px] uppercase tracking-wide text-violet-400/90">Stabilizer dropped</p>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {d.trace.stabilizerDroppedMidis.map((m) => (
                      <span
                        key={`d-${m}`}
                        className="rounded bg-violet-950/50 px-1.5 py-0.5 font-mono text-[10px] text-violet-100 ring-1 ring-violet-900"
                      >
                        {midiLabel(m)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {!d.trace && <p className="text-xs text-zinc-600">No trace</p>}
        </div>
      </div>

      {d.pitchTelemetry != null ? (
        <details className="mt-3 text-xs text-zinc-500" open={false}>
          <summary className="cursor-pointer text-zinc-400 hover:text-zinc-300">Basic Pitch metrics (row snapshot)</summary>
          <TelemetryGrid t={d.pitchTelemetry} />
        </details>
      ) : null}

      {d.handlerProbeMs != null && (
        <p className="mt-2 text-[11px] font-mono text-zinc-500">
          Onset handler: evidence {d.handlerProbeMs.evidenceMs.toFixed(2)} ms · score{" "}
          {d.handlerProbeMs.scoreMs.toFixed(2)} ms
        </p>
      )}

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
