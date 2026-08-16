"use client";

import { useEffect, useState } from "react";
import { Midi } from "tonal";
import type { VerifyCalibrationPitchResult } from "@/lib/calibration/verify-calibration-pitch";

export type CalibrationOnsetDebugInfo = {
  capturedAtMs: number;
  rms: number;
  flux: number | undefined;
  fluxThreshold: number | undefined;
  expectedMidi: number;
  expectedNote: string;
  evidenceCount: number;
  evidenceMidis: number[];
  verifyResult: VerifyCalibrationPitchResult;
  skipped?: boolean;
  skipReason?: string;
};

export type CalibrationDebugSnapshot = {
  onsetCount: number;
  lastOnset: CalibrationOnsetDebugInfo | null;
};

type Props = {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  snapshot: CalibrationDebugSnapshot;
};

function formatMidi(midi: number | null | undefined): string {
  if (midi == null || !Number.isFinite(midi)) return "—";
  const rounded = Math.round(midi);
  return `${Midi.midiToNoteName(rounded)} (MIDI ${midi.toFixed(1)})`;
}

function formatCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const rounded = Math.round(cents);
  if (rounded === 0) return "0 cents";
  const direction = rounded > 0 ? "sharp" : "flat";
  return `${Math.abs(rounded)} cents ${direction}`;
}

function describeVerifyStatus(result: VerifyCalibrationPitchResult): string {
  if (result.ok) {
    switch (result.method) {
      case "basic_pitch_evidence":
        return "Passed — Basic Pitch evidence match";
      case "yin":
        return "Passed — YIN pitch match";
      case "spectrum":
        return "Passed — spectrum harmonic match";
      default:
        return "Passed";
    }
  }

  switch (result.failureReason) {
    case "evidence_mismatch":
      return "Failed — Basic Pitch heard a different note";
    case "no_evidence_yin_failed":
      return "Failed — no Basic Pitch evidence and YIN could not lock pitch";
    case "yin_out_of_tolerance":
      return "Failed — YIN pitch outside tolerance";
    case "spectrum_mismatch":
      return "Failed — spectrum did not match expected note";
    case "no_pitch_detected":
      return "Failed — no pitch detected";
    default:
      return "Failed";
  }
}

function formatEvidenceMidis(midis: number[]): string {
  if (midis.length === 0) return "none";
  return midis.map((m) => m.toFixed(1)).join(", ");
}

export function CalibrationDebugPanel({ enabled, onToggle, snapshot }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || !expanded || snapshot.lastOnset == null) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [enabled, expanded, snapshot.lastOnset]);

  const lastOnset = snapshot.lastOnset;
  const lastOnsetAgeSec =
    lastOnset != null ? Math.max(0, (nowMs - lastOnset.capturedAtMs) / 1000) : null;

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-950/80 text-xs font-mono text-zinc-300">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-zinc-800">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="rounded border-zinc-600 bg-zinc-900"
          />
          <span className="text-zinc-200">Show debug</span>
        </label>
        {enabled ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-zinc-400 hover:text-zinc-200 touch-manipulation"
          >
            Debug panel {expanded ? "▲" : "▼"}
          </button>
        ) : null}
      </div>

      {enabled && expanded ? (
        <div className="space-y-2 px-3 py-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-400">
            <span>Onsets: {snapshot.onsetCount}</span>
            <span>
              Last:{" "}
              {lastOnsetAgeSec != null ? `${lastOnsetAgeSec.toFixed(1)}s ago` : "—"}
            </span>
            <span>RMS: {lastOnset != null ? lastOnset.rms.toFixed(4) : "—"}</span>
            <span>
              Flux:{" "}
              {lastOnset?.flux != null
                ? `${lastOnset.flux.toFixed(4)} / ${lastOnset.fluxThreshold?.toFixed(4) ?? "—"}`
                : "—"}
            </span>
          </div>

          {lastOnset?.skipped ? (
            <p className="text-amber-300">
              Skipped: {lastOnset.skipReason ?? "onset ignored for current step"}
            </p>
          ) : null}

          <div className="grid gap-1">
            <div className="flex justify-between gap-2">
              <span className="text-zinc-500">Expected</span>
              <span className="text-right">
                {lastOnset != null
                  ? `${lastOnset.expectedNote} — ${formatMidi(lastOnset.expectedMidi)}`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-500">Detected</span>
              <span className="text-right">
                {lastOnset != null
                  ? `${formatMidi(lastOnset.verifyResult.detectedMidi)} — ${formatCents(lastOnset.verifyResult.cents)}`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-500">BP evidence</span>
              <span className="text-right break-all">
                {lastOnset != null
                  ? `${lastOnset.evidenceCount} notes [${formatEvidenceMidis(lastOnset.evidenceMidis)}]`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-500">Harmonic support</span>
              <span className="text-right">
                {lastOnset != null
                  ? lastOnset.verifyResult.harmonicSupport.toExponential(2)
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-500">Status</span>
              <span
                className={
                  lastOnset?.verifyResult.ok ? "text-emerald-300 text-right" : "text-rose-300 text-right"
                }
              >
                {lastOnset != null ? describeVerifyStatus(lastOnset.verifyResult) : "—"}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
