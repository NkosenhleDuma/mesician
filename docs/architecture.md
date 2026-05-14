# Architecture

## Data flow

1. **Ingest**: Guitar Pro bytes → [@coderline/alphatab](https://www.alphatab.net/) `ScoreLoader.loadScoreFromBytes` → `MidiFileGenerator` to fill beat timers → events with `t0`/`t1` (seconds), strings, frets, MIDI, techniques.
2. **Classify**: Canonical `chart.json` per track → `classifyDifficulty` assigns a 1–7 tier from fret range, density, rhythm, chord size, and techniques → stored on `song_tracks`, rolled up onto `songs`.
3. **Tab edits**: User chart JSON → merged with machine chart (`applyUserChart`) → written to `user/` + effective `source/chart.json` → difficulty recomputed (`reencodeTrack`).
4. **Practice**: Client loads the source chart from `GET /api/songs/:id/tracks/:trackId/chart` → Web Audio scheduler plays notes → Pixi positions notes with `x = xPlayhead + (t0 - songTime) * pxPerSecond`.

## Modules

| Module | Role |
| --- | --- |
| Ingest + parse | `src/lib/gp/parse.ts` |
| Chart classification | `src/lib/chart/classify-difficulty.ts` |
| Library / auth | `src/app/api/*`, `src/lib/auth/*`, `src/lib/db/*` (Drizzle) |
| DB migrations | [`migrations/`](../migrations/) + [`scripts/migrate.ts`](../scripts/migrate.ts) (Kysely); see [migrations.md](migrations.md) |
| Playback transport | `src/lib/audio/transport.ts`, `synth-scheduler.ts` |
| Renderer | `src/components/practice/HighwayCanvas.tsx` |
| Scoring (MVP) | `src/lib/scoring/*` (pitch estimate + hit window) |
| Calibration | `src/lib/calibration/storage.ts` (localStorage latency) |

## Storage layout (MinIO)

- `songs/{songId}/uploads/{uploadId}.gp|gp3|gp4|gp5|gpx` — raw file  
- `songs/{songId}/tracks/{trackId}/machine/chart.json` — immutable import  
- `songs/{songId}/tracks/{trackId}/source/chart.json` — effective chart used for practice and edits  
- `songs/{songId}/tracks/{trackId}/user/chart.json` — last saved user tab JSON  
