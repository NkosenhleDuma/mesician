# `chart.json` (version 1)

Validated in code by `chartJsonSchema` in `src/lib/chart/types.ts`.

## Top level

| Field | Type | Description |
| --- | --- | --- |
| `version` | `1` | Schema version |
| `meta` | object | Song/track metadata |
| `events` | array | Note/chord events, sorted by `t0` |
| `duration` | number | Song length in seconds |

## `meta`

| Field | Description |
| --- | --- |
| `songTitle` | Title string |
| `trackName` | Track name |
| `tempoMap` | `{ t: seconds, bpm: number }[]` — MVP often `[{ t: 0, bpm: … }]` |
| `timeSig` | `{ t, num, den }[]` |
| `tuning` | String array, e.g. `["E2","A2",…,"E4"]` |

## `events[]`

| Field | Description |
| --- | --- |
| `id` | Stable string id (e.g. `evt_…`) |
| `t0`, `t1` | Start/end in **seconds** (float). For Guitar Pro imports, times follow **playback order** (repeated passages appear multiple times at successive wall-clock positions; no “dead gap” where repeats were skipped). |
| `kind` | `"note"` or `"chord"` |
| `notes` | Array of `{ string: 1..6, fret: int ≥ 0, midi: int }` |
| `tech` | Optional string tags: `hammer`, `slide`, `bend`, `mute`, etc. |

## Timing semantics (GP import)

Machine charts produced by ingest use AlphaTab’s playback-linear timeline (`MidiTickLookup` + `syncPoints`). Chart **`duration`** is `max(event.t1)` after sorting. **`meta.tempoMap`** is built separately via `MidiFileGenerator.generateSyncPoints` on the **full** score (multi-track); it remains suitable for UI tempo display even though per-event timing is derived from single-track MIDI generation.

## Editor round-trips

Saving from the tab editor sends a full `ChartJson` to `PUT /api/songs/:id/tracks/:trackId/chart-source`. Event `id`s should be preserved when possible so client-side tooling can diff; the server updates the effective source chart and recomputes difficulty after merge.
