import type { ChartEvent, ChartJson } from "./types";

function clampDifficulty(value: number): number {
  return Math.min(7, Math.max(1, value));
}

function tierFromMaxFret(maxFret: number): number {
  if (maxFret <= 3) return 1;
  if (maxFret <= 5) return 2;
  if (maxFret <= 7) return 3;
  if (maxFret <= 9) return 4;
  if (maxFret <= 12) return 5;
  if (maxFret <= 15) return 6;
  return 7;
}

function tierFromChordSize(maxChordSize: number): number {
  if (maxChordSize <= 1) return 1;
  if (maxChordSize === 2) return 4;
  if (maxChordSize === 3) return 6;
  return 7;
}

function getPeakEventDensity(events: ChartEvent[]): number {
  if (events.length === 0) return 0;
  const sorted = [...events].sort((a, b) => a.t0 - b.t0);
  let maxDensity = 0;
  let end = 0;

  for (let start = 0; start < sorted.length; start++) {
    const windowStart = sorted[start].t0;
    while (end < sorted.length && sorted[end].t0 < windowStart + 1) {
      end++;
    }
    maxDensity = Math.max(maxDensity, end - start);
  }

  return maxDensity;
}

function tierFromDensity(density: number): number {
  if (density <= 2) return 1;
  if (density <= 3) return 2;
  if (density <= 4) return 3;
  if (density <= 6) return 4;
  if (density <= 8) return 5;
  if (density <= 10) return 6;
  return 7;
}

function getMinOnsetGap(chart: ChartJson): number | null {
  const onsets = [...new Set(chart.events.map((event) => event.t0))]
    .sort((a, b) => a - b)
    .filter((t0) => Number.isFinite(t0));

  let minGap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < onsets.length; i++) {
    const gap = onsets[i] - onsets[i - 1];
    if (gap > 0 && gap < minGap) minGap = gap;
  }

  return Number.isFinite(minGap) ? minGap : null;
}

function tierFromRhythm(chart: ChartJson): number {
  const minGap = getMinOnsetGap(chart);
  if (minGap == null) return 1;

  const bpm = chart.meta.tempoMap[0]?.bpm ?? 120;
  const beatSec = bpm > 0 ? 60 / bpm : 0.5;
  const beatFraction = minGap / beatSec;

  if (beatFraction >= 0.5) return 1;
  if (beatFraction >= 0.25) return 3;
  if (beatFraction >= 0.125) return 5;
  if (beatFraction >= 0.0625) return 6;
  return 7;
}

function tierFromTechniques(chart: ChartJson): number {
  let hasHammerPull = false;
  let hasExpressiveTech = false;
  let hasAdvancedTech = false;

  for (const event of chart.events) {
    for (const tech of event.tech ?? []) {
      if (tech === "hammer" || tech === "pull") hasHammerPull = true;
      if (tech === "slide" || tech === "mute" || tech === "vibrato") hasExpressiveTech = true;
      if (tech === "bend") hasAdvancedTech = true;
    }

    for (const note of event.notes) {
      if (note.palmMute || note.vibrato || note.dead) hasExpressiveTech = true;
    }
  }

  if (hasAdvancedTech) return 7;
  if (hasExpressiveTech) return 6;
  if (hasHammerPull) return 4;
  return 1;
}

export function classifyDifficulty(chart: ChartJson): number {
  if (chart.events.length === 0) return 1;

  const maxFret = Math.max(...chart.events.flatMap((event) => event.notes.map((note) => note.fret)));
  const maxChordSize = Math.max(...chart.events.map((event) => event.notes.length));
  const peakDensity = getPeakEventDensity(chart.events);

  return clampDifficulty(
    Math.max(
      tierFromMaxFret(maxFret),
      tierFromChordSize(maxChordSize),
      tierFromDensity(peakDensity),
      tierFromRhythm(chart),
      tierFromTechniques(chart),
    ),
  );
}
