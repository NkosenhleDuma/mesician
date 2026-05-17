import type { DebugDecision, DebugDecisionOutcome, DebugReportMeta } from "./debug-capture";
import {
  classifyOnsetDebugOutcome,
  expectedSnapshotToChartEvent,
  scoreBpOnsetAgainstEvent,
  scoreOnsetAgainstEvent,
  type OnsetRecognizerTuning,
} from "./recognize";

export const REPLAY_SAMPLE_RATE_FALLBACK = 48000;

/** Re-score a captured onset + spectrum when `expectedEvent` and buffers exist; otherwise null. */
export function replayDecisionOutcome(
  decision: DebugDecision,
  meta: Pick<DebugReportMeta, "audioSampleRate">,
  inputLatencyMs: number,
  tuning?: OnsetRecognizerTuning,
): DebugDecisionOutcome | null {
  if (!decision.expectedEvent) return null;

  const ev = expectedSnapshotToChartEvent(decision.expectedEvent);

  if (decision.trace?.kind === "bp") {
    const r = scoreBpOnsetAgainstEvent(
      ev,
      decision.songTimeSec,
      new Set(decision.trace.evidenceMidis.map((m) => Math.round(m))),
      inputLatencyMs,
      tuning,
    );
    let appliedPitchHit = false;
    for (const nh of r.notes) {
      if (nh.pitchOk && nh.verdict !== "miss") {
        appliedPitchHit = true;
        break;
      }
    }
    return classifyOnsetDebugOutcome(appliedPitchHit, r, ev);
  }

  if (decision.spectrum.length === 0 || decision.waveSnippet.length === 0) return null;

  const sr = meta.audioSampleRate ?? REPLAY_SAMPLE_RATE_FALLBACK;
  const spec = Float32Array.from(decision.spectrum);
  const wave = Float32Array.from(decision.waveSnippet);
  const r = scoreOnsetAgainstEvent(ev, decision.songTimeSec, wave, spec, sr, inputLatencyMs, tuning);

  let appliedPitchHit = false;
  for (const nh of r.notes) {
    if (nh.pitchOk && nh.verdict !== "miss") {
      appliedPitchHit = true;
      break;
    }
  }
  return classifyOnsetDebugOutcome(appliedPitchHit, r, ev);
}

export function isReplayableDecision(d: DebugDecision): boolean {
  if (!d.expectedEvent) return false;
  if (d.trace?.kind === "bp") return true;
  return d.spectrum.length > 0 && d.waveSnippet.length > 0;
}
