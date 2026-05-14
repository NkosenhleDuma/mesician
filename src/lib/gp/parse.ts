import { importer, midi, model, Settings } from "@coderline/alphatab";
import { v4 as uuidv4 } from "uuid";
import type { ChartEvent, ChartJson, ChartMeta } from "../chart/types";

function noopMidiHandler(): midi.IMidiFileHandler {
  return {
    addTimeSignature() {},
    addRest() {},
    addNote() {},
    addControlChange() {},
    addProgramChange() {},
    addTempo() {},
    addNoteBend() {},
    addBend() {},
    finishTrack() {},
    addTickShift() {},
  };
}

/** AlphaTab only assigns `beat.timer` during MIDI generation when `showTimer` is true. */
function enableBeatTimersForScore(score: model.Score): void {
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            beat.showTimer = true;
          }
        }
      }
    }
  }
}

/**
 * MidiFileGenerator uses one `_currentTime` and walks every track per master bar; that stacks time across
 * tracks in the same measure. Run generation with only this track so `beat.timer` matches the song timeline.
 */
function assignBeatTimersForTrack(score: model.Score, settings: Settings, trackIndex: number): void {
  const allTracks = score.tracks.slice();
  const single = allTracks[trackIndex];
  if (!single) return;
  score.tracks = [single];
  try {
    new midi.MidiFileGenerator(score, settings, noopMidiHandler()).generate();
  } finally {
    score.tracks = allTracks;
  }
}

function tuningToStrings(staff: model.Staff): string[] {
  const tun = staff.stringTuning;
  return tun.tunings.map((n) => model.Tuning.getTextForTuning(n, true));
}

function linkHammerPullPairs(events: ChartEvent[]): void {
  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i];
    if (a.hammerPullPeerId) continue;
    const b = events[i + 1];
    if (b.hammerPullPeerId) continue;
    if (a.kind !== "note" || b.kind !== "note") continue;
    if (a.notes.length !== 1 || b.notes.length !== 1) continue;
    if (a.notes[0].string !== b.notes[0].string) continue;
    const t = a.tech ?? [];
    if (!t.includes("hammer") && !t.includes("pull")) continue;
    if (b.t0 < a.t0) continue;
    if (b.t0 - a.t1 > 0.15) continue;
    a.hammerPullPeerId = b.id;
    b.hammerPullPeerId = a.id;
  }
}

function collectTech(note: model.Note): string[] {
  const tech: string[] = [];
  if (note.isHammerPullOrigin) {
    const dest = note.hammerPullDestination;
    if (dest) {
      const d = dest.realValue - note.realValue;
      tech.push(d < 0 ? "pull" : "hammer");
    } else {
      tech.push("hammer");
    }
  }
  if (note.hasBend) tech.push("bend");
  if (note.isPalmMute) tech.push("mute");
  if (note.slideOutType !== model.SlideOutType.None) tech.push("slide");
  if (note.slideInType !== model.SlideInType.None) tech.push("slide");
  return tech;
}

/** AlphaTab quarter-note resolution used in MIDI timing (matches MidiUtils in generator). */
const TICKS_PER_QUARTER = 480;

function buildTempoMapFromSyncPoints(score: model.Score): { t: number; bpm: number }[] {
  const points = midi.MidiFileGenerator.generateSyncPoints(score, false);
  const raw = points.map((p) => ({ t: p.synthTime / 1000, bpm: p.synthBpm }));
  raw.sort((a, b) => a.t - b.t);
  const out: { t: number; bpm: number }[] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (!last || last.bpm !== p.bpm) out.push(p);
  }
  if (out.length === 0) return [{ t: 0, bpm: score.tempo }];
  return out;
}

function bpmAtBeat(beat: model.Beat, score: model.Score): number {
  const mb = beat.voice.bar.masterBar;
  const barDuration = mb.calculateDuration();
  const ratio = barDuration > 0 ? beat.playbackStart / barDuration : 0;
  const sorted = mb.tempoAutomations.slice().sort((a, b) => a.ratioPosition - b.ratioPosition);
  let tempo = mb.tempoAutomations.length > 0 ? mb.tempoAutomations[0].value : score.tempo;
  for (const a of sorted) {
    if (a.ratioPosition <= ratio + 1e-12) tempo = a.value;
  }
  return tempo > 0 ? tempo : score.tempo;
}

function playbackDurationSeconds(playbackDurationTicks: number, bpm: number): number {
  const b = bpm > 0 ? bpm : 120;
  return (playbackDurationTicks / TICKS_PER_QUARTER) * (60 / b);
}

/** Next note end time from following beats with filled timers, else BPM-based duration. */
function resolveT1(beat: model.Beat, t0: number, score: model.Score, staff: model.Staff, voice: model.Voice): number {
  let b: model.Beat | null = beat.nextBeat;
  while (b) {
    if (b.timer != null) return Math.max(t0 + 0.02, b.timer / 1000);
    b = b.nextBeat;
  }
  const bars = staff.bars;
  const bar = voice.bar;
  const barIdx = bars.indexOf(bar);
  if (barIdx >= 0) {
    let seenCurrent = false;
    for (let i = barIdx; i < bars.length; i++) {
      const v = bars[i].voices[0];
      if (!v) continue;
      for (const bb of v.beats) {
        if (i === barIdx && !seenCurrent) {
          if (bb === beat) seenCurrent = true;
          continue;
        }
        if (bb.timer != null) return Math.max(t0 + 0.02, bb.timer / 1000);
      }
    }
  }
  const bpm = bpmAtBeat(beat, score);
  const dur = playbackDurationSeconds(beat.playbackDuration, bpm);
  return t0 + Math.max(0.02, dur);
}

function buildTimeSig(score: { masterBars: { timeSignatureNumerator: number; timeSignatureDenominator: number }[] }): {
  t: number;
  num: number;
  den: number;
}[] {
  if (!score.masterBars.length) return [{ t: 0, num: 4, den: 4 }];
  return [{ t: 0, num: score.masterBars[0].timeSignatureNumerator, den: score.masterBars[0].timeSignatureDenominator }];
}

function keySignatureRootName(ks: model.KeySignature): string {
  switch (ks) {
    case model.KeySignature.Cb:
      return "Cb";
    case model.KeySignature.Gb:
      return "Gb";
    case model.KeySignature.Db:
      return "Db";
    case model.KeySignature.Ab:
      return "Ab";
    case model.KeySignature.Eb:
      return "Eb";
    case model.KeySignature.Bb:
      return "Bb";
    case model.KeySignature.F:
      return "F";
    case model.KeySignature.C:
      return "C";
    case model.KeySignature.G:
      return "G";
    case model.KeySignature.D:
      return "D";
    case model.KeySignature.A:
      return "A";
    case model.KeySignature.E:
      return "E";
    case model.KeySignature.B:
      return "B";
    case model.KeySignature.FSharp:
      return "F#";
    case model.KeySignature.CSharp:
      return "C#";
    default:
      return "C";
  }
}

function keyFromFirstBar(bar: model.Bar | undefined): string | undefined {
  if (!bar) return undefined;
  const root = keySignatureRootName(bar.keySignature);
  const qual = bar.keySignatureType === model.KeySignatureType.Minor ? "minor" : "major";
  return `${root} ${qual}`;
}

function staffChartMeta(metaBase: Omit<ChartMeta, "trackName">, staff: model.Staff, trackName: string, tuning: string[]): ChartMeta {
  const capoFret = staff.capo > 0 ? staff.capo : undefined;
  const key = keyFromFirstBar(staff.bars[0]);
  return {
    ...metaBase,
    trackName,
    tuning,
    ...(capoFret !== undefined ? { capoFret } : {}),
    ...(key !== undefined ? { key } : {}),
  };
}

export type ParsedTrackSummary = {
  trackIndex: number;
  name: string;
  instrument: string | null;
  tuning: string[];
  isGuitar: boolean;
};

export function parseGpToCharts(buffer: Buffer): {
  metaBase: Omit<ChartMeta, "trackName">;
  tracks: ParsedTrackSummary[];
  chartsByTrack: ChartJson[];
} {
  const data = new Uint8Array(buffer);
  const score = importer.ScoreLoader.loadScoreFromBytes(data);
  const settings = new Settings();
  score.finish(settings);
  enableBeatTimersForScore(score);

  const metaBase: Omit<ChartMeta, "trackName"> = {
    songTitle: score.title || "Untitled",
    tempoMap: buildTempoMapFromSyncPoints(score),
    timeSig: buildTimeSig(score),
    tuning: ["E2", "A2", "D3", "G3", "B3", "E4"],
  };

  const tracks: ParsedTrackSummary[] = [];
  const chartsByTrack: ChartJson[] = [];

  score.tracks.forEach((track, trackIndex) => {
    assignBeatTimersForTrack(score, settings, trackIndex);
    const staff = track.staves[0];
    const isGuitar = !track.isPercussion && !!staff?.isStringed;
    const tuning = staff ? tuningToStrings(staff) : metaBase.tuning;
    tracks.push({
      trackIndex,
      name: track.name || `Track ${trackIndex + 1}`,
      instrument: track.playbackInfo != null ? String(track.playbackInfo.program) : null,
      tuning,
      isGuitar,
    });

    const events: ChartEvent[] = [];
    if (!staff) {
      chartsByTrack.push({
        version: 1,
        meta: { ...metaBase, trackName: track.name || `Track ${trackIndex + 1}`, tuning },
        events,
        duration: 0,
      });
      return;
    }

    for (const bar of staff.bars) {
      const voice = bar.voices[0];
      if (!voice) continue;
      for (const beat of voice.beats) {
        if (beat.isEmpty || beat.isRest) continue;
        const visibleNotes = beat.notes.filter((n) => n.isVisible && !n.isPercussion);
        if (visibleNotes.length === 0) continue;

        const t0 = (beat.timer ?? 0) / 1000;
        const t1 = resolveT1(beat, t0, score, staff, voice);

        const notes = visibleNotes.map((n) => {
          const vib =
            n.vibrato !== model.VibratoType.None || beat.vibrato !== model.VibratoType.None;
          

          if (n.fret < 0) {
            console.log("n", n);
          }
          const fret = n.fret < 0 ? 0 : n.fret;
          const dead = n.isDead || n.fret < 0;
          return {
            string: n.string,
            fret,
            midi: n.realValue,
            ...(dead ? { dead: true as const } : {}),
            ...(n.isPalmMute ? { palmMute: true as const } : {}),
            ...(vib ? { vibrato: true as const } : {}),
          };
        });

        const tech = new Set<string>();
        for (const n of visibleNotes) {
          for (const t of collectTech(n)) tech.add(t);
        }

        const kind = notes.length > 1 ? "chord" : "note";
        events.push({
          id: `evt_${uuidv4()}`,
          t0,
          t1,
          kind,
          notes,
          tech: tech.size ? Array.from(tech) : undefined,
        });
      }
    }

    events.sort((a, b) => a.t0 - b.t0);
    linkHammerPullPairs(events);
    const duration = events.length ? Math.max(...events.map((e) => e.t1)) : 0;

    chartsByTrack.push({
      version: 1,
      meta: staffChartMeta(metaBase, staff, track.name || `Track ${trackIndex + 1}`, tuning),
      events,
      duration,
    });
  });

  return { metaBase, tracks, chartsByTrack };
}
