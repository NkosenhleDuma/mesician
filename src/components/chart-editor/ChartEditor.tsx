"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { chordLabelFromMidis } from "@/lib/chart/chord-label";
import {
  removeEventAndFixPeers,
  sanitizeChart,
  syncEventMidis,
  syncNoteMidi,
} from "@/lib/chart/note-midi";
import type { ChartEvent, ChartJson, ChartNote } from "@/lib/chart/types";
import { validateChartJson } from "@/lib/chart/types";

function newEventId(): string {
  return `evt_${uuidv4()}`;
}

function defaultNote(meta: ChartJson["meta"]): ChartNote {
  const n: ChartNote = { string: 1, fret: 0, midi: 64 };
  return syncNoteMidi(n, meta);
}

function emptyEvent(meta: ChartJson["meta"], t0: number, t1: number): ChartEvent {
  return {
    id: newEventId(),
    t0,
    t1,
    kind: "note",
    notes: [defaultNote(meta)],
  };
}

type Props = { songId: string; trackId: string };

/** Tab-style order: GP string 1 (high E) at top → string 6 at bottom */
function EventStringPreview({
  ev,
  selected,
  onClick,
}: {
  ev: ChartEvent;
  selected: boolean;
  onClick: () => void;
}) {
  const byString = new Map<number, ChartNote[]>();
  for (const n of ev.notes) {
    const list = byString.get(n.string) ?? [];
    list.push(n);
    byString.set(n.string, list);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-2 transition-colors ${
        selected ? "border-emerald-500 bg-emerald-950/40" : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs text-zinc-400">
        <span>
          {ev.t0.toFixed(2)}s → {ev.t1.toFixed(2)}s
        </span>
        <span className="text-zinc-500">{ev.kind === "chord" ? "Chord" : "Note"}</span>
      </div>
      <div className="space-y-0.5 font-mono text-[11px]">
        {Array.from({ length: 6 }, (_, i) => {
          const gpString = i + 1;
          const notesHere = byString.get(gpString) ?? [];
          return (
            <div key={gpString} className="flex items-center gap-2 min-h-[22px]">
              <span className="w-3 text-zinc-600 shrink-0">{gpString}</span>
              <div className="flex-1 h-px bg-zinc-700 relative flex items-center">
                {notesHere.map((n, idx) => (
                  <span
                    key={`${n.string}-${n.fret}-${idx}`}
                    className={`absolute left-3 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      n.dead
                        ? "bg-rose-900/80 text-rose-100"
                        : n.fret === 0
                          ? "bg-zinc-600 text-zinc-100"
                          : ev.kind === "chord"
                            ? "bg-sky-800 text-sky-100"
                            : "bg-emerald-800 text-emerald-100"
                    }`}
                    style={{ marginLeft: idx * 36 }}
                  >
                    {n.dead ? "×" : n.fret}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </button>
  );
}

export function ChartEditor({ songId, trackId }: Props) {
  const router = useRouter();
  const [chart, setChart] = useState<ChartJson | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/songs/${songId}/tracks/${trackId}/chart-source`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<{ chart: ChartJson }>;
      })
      .then((data) => {
        if (!cancelled) {
          setChart(data.chart);
          setLoading(false);
          const sorted = [...data.chart.events].sort((a, b) => a.t0 - b.t0);
          if (sorted[0]) setSelectedId(sorted[0].id);
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

  useEffect(() => {
    if (rawOpen && chart) setRawText(JSON.stringify(chart, null, 2));
  }, [rawOpen, chart]);

  const sortedEvents = useMemo(() => {
    if (!chart) return [];
    return [...chart.events].sort((a, b) => a.t0 - b.t0);
  }, [chart]);

  const selected = useMemo(
    () => sortedEvents.find((e) => e.id === selectedId) ?? null,
    [sortedEvents, selectedId],
  );

  const updateChart = useCallback((fn: (c: ChartJson) => ChartJson) => {
    setChart((c) => (c ? fn(c) : c));
    setErr(null);
  }, []);

  const patchSelected = useCallback(
    (fn: (ev: ChartEvent) => ChartEvent) => {
      if (!chart || !selectedId) return;
      updateChart((c) => {
        const events = c.events.map((e) => (e.id === selectedId ? syncEventMidis(fn(e), c.meta) : e));
        return sanitizeChart({ ...c, events });
      });
    },
    [chart, selectedId, updateChart],
  );

  function addEvent() {
    if (!chart) return;
    const sorted = [...chart.events].sort((a, b) => a.t0 - b.t0);
    const last = sorted[sorted.length - 1];
    const t0 = last ? last.t1 : 0;
    const t1 = t0 + 0.25;
    const ev = emptyEvent(chart.meta, t0, t1);
    setSelectedId(ev.id);
    updateChart((c) => sanitizeChart({ ...c, events: [...c.events, ev] }));
  }

  function deleteSelected() {
    if (!chart || !selectedId) return;
    const events = removeEventAndFixPeers(chart.events, selectedId);
    const sorted = [...events].sort((a, b) => a.t0 - b.t0);
    setSelectedId(sorted[0]?.id ?? null);
    updateChart((c) => sanitizeChart({ ...c, events }));
  }

  function duplicateSelected() {
    if (!chart || !selected) return;
    const dt = selected.t1 - selected.t0;
    const t0 = selected.t1;
    const t1 = t0 + dt;
    const copy: ChartEvent = {
      ...selected,
      id: newEventId(),
      t0,
      t1,
      hammerPullPeerId: undefined,
      notes: selected.notes.map((n) => ({ ...n })),
    };
    const synced = syncEventMidis(copy, chart.meta);
    setSelectedId(synced.id);
    updateChart((c) => sanitizeChart({ ...c, events: [...c.events, synced] }));
  }

  async function save() {
    if (!chart) return;
    setErr(null);
    setSaving(true);
    try {
      const normalized = sanitizeChart(chart);
      validateChartJson(normalized);
      const res = await fetch(`/api/songs/${songId}/tracks/${trackId}/chart-source`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
      });
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      router.push(`/library/${songId}`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid chart");
    } finally {
      setSaving(false);
    }
  }

  function applyRawJson() {
    setErr(null);
    try {
      const parsed = JSON.parse(rawText) as unknown;
      const c = validateChartJson(parsed);
      setChart(c);
      const sorted = [...c.events].sort((a, b) => a.t0 - b.t0);
      setSelectedId(sorted[0]?.id ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  if (loading) return <p className="text-zinc-400">Loading…</p>;
  if (!chart) return <p className="text-red-400 text-sm">{err ?? "No chart"}</p>;

  const chordLabel =
    selected && selected.notes.length > 1
      ? chordLabelFromMidis(
          selected.notes.map((n) => n.midi),
          chart.meta.capoFret,
        )
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={`/library/${songId}`} className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Back to song
        </Link>
        <Link
          href={`/library/${songId}/tracks/${trackId}/debug`}
          className="text-sm text-violet-400 hover:text-violet-300"
        >
          Mic debug reports
        </Link>
      </div>
      <h1 className="text-xl font-semibold text-white">Edit tab</h1>
      <p className="text-sm text-zinc-500 max-w-2xl">
        Edit chart events (times in seconds, strings 1–6). Saving stores your version merged with the original import
        and recomputes difficulty.
      </p>
      {err && <p className="text-red-400 text-sm">{err}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={addEvent}
          className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700"
        >
          Add event
        </button>
        <button
          type="button"
          onClick={duplicateSelected}
          disabled={!selected}
          className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700 disabled:opacity-40 disabled:pointer-events-none"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={deleteSelected}
          disabled={!selected}
          className="px-3 py-2 rounded-lg bg-red-900/50 text-red-200 text-sm hover:bg-red-900/70 disabled:opacity-40 disabled:pointer-events-none"
        >
          Delete event
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save & recompute difficulty"}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-300">Events ({sortedEvents.length})</h2>
          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {sortedEvents.map((ev) => (
              <EventStringPreview
                key={ev.id}
                ev={ev}
                selected={ev.id === selectedId}
                onClick={() => setSelectedId(ev.id)}
              />
            ))}
            {sortedEvents.length === 0 && (
              <p className="text-sm text-zinc-500">No events yet. Add one to get started.</p>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 className="text-sm font-medium text-zinc-300">Selected event</h2>
          {!selected ? (
            <p className="text-sm text-zinc-500">Select an event from the list.</p>
          ) : (
            <>
              {chordLabel && (
                <p className="text-xs text-sky-300/90">
                  Chord hint: <span className="font-medium">{chordLabel}</span>
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 block text-xs text-zinc-500">
                  t0 (s)
                  <input
                    type="number"
                    step="0.01"
                    value={selected.t0}
                    onChange={(e) => {
                      const t0 = Number(e.target.value);
                      patchSelected((ev) => ({ ...ev, t0 }));
                    }}
                    className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-sm text-white"
                  />
                </label>
                <label className="space-y-1 block text-xs text-zinc-500">
                  t1 (s)
                  <input
                    type="number"
                    step="0.01"
                    value={selected.t1}
                    onChange={(e) => {
                      const t1 = Number(e.target.value);
                      patchSelected((ev) => ({ ...ev, t1 }));
                    }}
                    className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-sm text-white"
                  />
                </label>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">Notes</span>
                  <button
                    type="button"
                    onClick={() =>
                      patchSelected((ev) => {
                        const next = [...ev.notes, defaultNote(chart.meta)];
                        return { ...ev, notes: next, kind: next.length > 1 ? "chord" : "note" };
                      })
                    }
                    className="text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    + Add string
                  </button>
                </div>
                {selected.notes.map((note, idx) => (
                  <div
                    key={`${selected.id}-n-${idx}`}
                    className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-800 p-2 bg-zinc-900/50"
                  >
                    <label className="space-y-1 text-xs text-zinc-500">
                      Str
                      <select
                        value={note.string}
                        onChange={(e) => {
                          const string = Number(e.target.value);
                          patchSelected((ev) => {
                            const notes = ev.notes.map((n, i) =>
                              i === idx ? syncNoteMidi({ ...n, string }, chart.meta) : n,
                            );
                            return { ...ev, notes, kind: notes.length > 1 ? "chord" : "note" };
                          });
                        }}
                        className="block rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-sm text-white"
                      >
                        {[1, 2, 3, 4, 5, 6].map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs text-zinc-500">
                      Fret
                      <input
                        type="number"
                        min={0}
                        value={note.fret}
                        onChange={(e) => {
                          const fret = Math.max(0, Math.round(Number(e.target.value) || 0));
                          patchSelected((ev) => {
                            const notes = ev.notes.map((n, i) =>
                              i === idx ? syncNoteMidi({ ...n, fret }, chart.meta) : n,
                            );
                            return { ...ev, notes, kind: notes.length > 1 ? "chord" : "note" };
                          });
                        }}
                        className="w-20 rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-sm text-white"
                      />
                    </label>
                    <span className="text-[11px] text-zinc-600 pb-2">midi {note.midi}</span>
                    {(["dead", "palmMute", "vibrato"] as const).map((k) => (
                      <label key={k} className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(note[k])}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            patchSelected((ev) => {
                              const notes = ev.notes.map((n, i) =>
                                i === idx ? { ...n, [k]: checked || undefined } : n,
                              );
                              return { ...ev, notes };
                            });
                          }}
                          className="rounded border-zinc-600"
                        />
                        {k}
                      </label>
                    ))}
                    <button
                      type="button"
                      disabled={selected.notes.length <= 1}
                      onClick={() =>
                        patchSelected((ev) => {
                          const notes = ev.notes.filter((_, i) => i !== idx);
                          return { ...ev, notes, kind: notes.length > 1 ? "chord" : "note" };
                        })
                      }
                      className="ml-auto text-xs text-red-400 hover:text-red-300 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setRawOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900/80 text-sm text-zinc-300 hover:bg-zinc-900"
        >
          <span>Advanced: raw JSON</span>
          <span className="text-zinc-500">{rawOpen ? "▼" : "▶"}</span>
        </button>
        {rawOpen && (
          <div className="p-3 space-y-2 border-t border-zinc-800">
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="w-full min-h-[220px] font-mono text-sm bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-200"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={applyRawJson}
              className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700"
            >
              Apply raw JSON
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
