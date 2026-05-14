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
| `t0`, `t1` | Start/end in **seconds** (float) |
| `kind` | `"note"` or `"chord"` |
| `notes` | Array of `{ string: 1..6, fret: int ≥ 0, midi: int }` |
| `tech` | Optional string tags: `hammer`, `slide`, `bend`, `mute`, etc. |

## Editor round-trips

Saving from the tab editor sends a full `ChartJson` to `PUT /api/songs/:id/tracks/:trackId/chart-source`. Event `id`s should be preserved when possible so client-side tooling can diff; the server updates the effective source chart and recomputes difficulty after merge.
