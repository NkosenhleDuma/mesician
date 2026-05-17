# Spec: Yousician-like Guitar Practice App (MVP, PixiJS + Guitar Pro)

## 0) Goal
Build a **Next.js 15** web app that lets users:
- create accounts + manage a song library
- upload **Guitar Pro** files (`.gp5`, `.gpx`)
- auto-generate **7 difficulty levels** from one GP file
- play back the song via **in-browser MIDI synth (SoundFont)**
- practice with a **game-like note highway** (PixiJS) + fixed playhead
- score performance via **audio input (DI into mic)** with **latency calibration** (auto + guided)
- support **desktop + mobile landscape** for full playability

### Non-goals (MVP)
- MIDI input scoring
- non-GP import formats
- full tab editor (authoring remains external)

---

## 1) Tech stack

### Frontend
- Next.js **15**, **App Router**
- PixiJS (vanilla integration; `@pixi/react` not required)
- WebAudio API for:
  - MIDI synth playback
  - mic/line-in capture for scoring

### Backend
- Node.js service inside Next.js (Route Handlers) for MVP
- Postgres for metadata + accounts
- MinIO for binary file storage (GP uploads + derived `chart.json` artifacts)

### Local/Prod ops
- `Dockerfile`
- `docker-compose.local.yml` includes: app, postgres, minio
- `docker-compose.prod.yml` includes same services (prod defaults, env-driven)

---

## 2) High-level architecture

### Modules
1. **Ingest + Parse**: GP file → normalized internal model
2. **Encode**: normalized model → `chart.json` + 7 derived level charts
3. **Library**: accounts, songs, versions, tracks, levels
4. **Playback Transport**: authoritative clock based on WebAudio time
5. **Renderer**: PixiJS scene for highway + chord spans + effects
6. **Scoring Engine**: audio input analysis + note/chord judgement + technique heuristics
7. **Calibration**: guided + auto estimation of input latency offset

---

## 3) Data model (Postgres)

### Tables (minimal)
- `users`
  - `id`, `email`, `password_hash` (or provider id), `created_at`
- `songs`
  - `id`, `user_id`, `title`, `artist` (optional), `created_at`
- `song_uploads`
  - `id`, `song_id`, `filename`, `gp_format` (`gp5|gpx`), `minio_object_key`, `uploaded_at`
- `song_tracks`
  - `id`, `song_id`, `track_index`, `name`, `instrument`, `tuning_json`, `is_guitar` boolean
- `song_levels`
  - `id`, `song_id`, `track_id`, `level` int (1..7), `chart_object_key` (MinIO), `chart_hash`, `created_at`
- `practice_sessions` (optional MVP but recommended)
  - `id`, `user_id`, `song_level_id`, `started_at`, `ended_at`, `score_json`

### Storage rules
- **MinIO** stores:
  - raw GP upload: `songs/{songId}/uploads/{uploadId}.{ext}`
  - derived charts: `songs/{songId}/tracks/{trackId}/levels/{level}/chart.json`
  - optional rendered assets later

---

## 4) Internal chart format (`chart.json`)

### Core principles
- Time in **seconds** (float)
- Events are immutable, sorted by `t0`
- Supports:
  - single notes
  - chords (multiple notes at same `t0`)
  - sustains (`t1 > t0`)
  - technique annotations (`hammer`, `pull`, `slide`, `bend`, `mute`, `vibrato`)

### Schema (MVP)
**Note:** to keep this spec copy-paste-safe, the JSON example is *indented* and not fenced.

```json
    {
      "version": 1,
      "meta": {
        "songTitle": "...",
        "trackName": "...",
        "tempoMap": [{"t":0,"bpm":120}],
        "timeSig": [{"t":0,"num":4,"den":4}],
        "tuning": ["E2","A2","D3","G3","B3","E4"]
      },
      "events": [
        {
          "id": "evt_...",
          "t0": 12.345,
          "t1": 12.545,
          "kind": "chord",
          "notes": [
            {"string":6,"fret":3,"midi":43},
            {"string":5,"fret":2,"midi":47}
          ],
          "tech": ["hammer","slide"]
        }
      ],
      "duration": 180.0
    }
```
---

## 5) Guitar Pro ingest & parsing

### Supported formats
- `.gp5`, `.gpx`

### Track handling
- Import **all tracks** from file
- Identify “guitar-like” tracks via instrument/tuning heuristics
- UI allows selecting track during practice

### Parsing deliverables
For each track:
- tuning + string count (assume 6 strings unless GP says otherwise; MVP still renders 6 lanes)
- tempo map + time signatures
- note events with:
  - string, fret, midi, start time, duration (seconds; **playback-linear**: repeats/volta/jumps expanded like MIDI playback)
  - techniques when available from GP

**Implementation note:** Mesician uses [@coderline/alphatab](https://www.alphatab.net/) (`ScoreLoader` + `MidiFileGenerator`). Event times come from **`MidiTickLookup`** after generation (not linear score order / first-pass beat timers). Tick→seconds conversion must use AlphaTab’s **960 ticks per quarter** (`MidiUtils.QuarterTime`), aligned with **`MidiFileGenerator.syncPoints`** from the same generate pass.

---

## 6) Level derivation (7 levels)

### Common transforms (applied progressively)
- **Technique stripping/normalization**: techniques removed or converted into “plain notes” where necessary (**affects note content**, not just rendering)
- **Rhythm simplification**
  - quantize to grid (grid depends on level)
  - reduce note density (cap notes/sec)
  - merge/trim very short notes below threshold
- **Fret range restriction** for early levels
- **Chord collapsing**
  - when collapsed: chord can still render visually, but scoring expects **root note**
  - root note definition: lowest MIDI note in chord (or lowest string+fret)

### Concrete level rules (MVP defaults)
**Level 1**
- frets 0–3
- single notes only (if chord: collapse to root)
- heavy quantize (e.g., 1/8)
- cap density: max 2 notes/sec (drop/merge extras)

**Level 2**
- frets 0–5
- single notes only
- quantize 1/16
- cap density: 3 notes/sec

**Level 3**
- frets 0–7
- single notes only
- lighter quantize 1/16
- cap density: 4 notes/sec

**Level 4**
- frets 0–9
- allow double-stops (2-note chords), but collapse >2 notes to root
- introduce technique expectations (hammer/pull) when present (see scoring section)
- quantize light

**Level 5**
- full fret range
- single notes and double-stops
- minimal quantize (or none), only cleanup

**Level 6**
- chords allowed for rendering
- scoring expects root-note + strum timing (**beta**)
- remove unsupported techniques by converting to plain notes

**Level 7**
- full fidelity chart (notes/chords as-is)
- technique expectations kept where present (**beta** judgement)

Each level output is a separate `chart.json` stored in MinIO.

---

## 7) MIDI playback (SoundFont synth)

### Requirements
- In-browser playback from chart tempo map (no external audio file required)
- Consistent timing with rendering and scoring
- Ability to:
  - play/pause
  - seek
  - loop section (optional MVP)
  - adjust tempo (optional MVP; fixed tempo is required)

### Approach
- Use WebAudio-based SoundFont synth (e.g., fluidsynth wasm or similar)
- Generate MIDI-like note on/off events from `chart.json`
- Transport anchors time to `AudioContext.currentTime`
- Apply tempo map when scheduling note events

---

## 8) PixiJS renderer

### Visual model
- Classic highway: notes move **right → left** into fixed playhead (`xPlayhead`)
- 6 string lanes always
- Chords span lanes: chord notes drawn across lanes at same `t0`
- Sustains rendered as tails

### Scene graph
- `BackgroundLayer`
- `LanesLayer` (6 strings + fret markers/measure lines)
- `NotesLayer` (heads + tails)
- `EffectsLayer` (hit/miss particles, lane glow)
- `PlayheadLayer` (fixed cursor + hit window)
- `UILayer` (score, streak, debug)

### Performance requirements
- Object pooling for note sprites/tails/effects
- Spawn/despawn windows (ahead/behind seconds)
- Single ticker loop using `requestAnimationFrame`/Pixi `ticker`
- No per-frame React re-renders for note objects (Pixi owns the scene)

### Positioning
- `x = xPlayhead + (event.t0 - songTime) * pxPerSecond`
- `y = laneY[string]`

---

## 9) Scoring engine

### Input capture
- WebAudio `getUserMedia({ audio: true })`
- Assume DI into mic input (still exposed as audio stream)

### Judgement modes
- **Monophonic pitch scoring** (primary, levels 1–5)
- **Chord scoring (beta)** (levels 6–7)
  - timing: detect strum onset vs expected chord time
  - pitch: chord-class heuristic (best effort), otherwise root-note accept
  - UI shows “beta chord scoring” label

### Timing tolerance
- Strict rhythm-game feel
- Configurable hit window (default e.g. `±40ms`) with difficulty scaling

### Technique judgement (heuristic-based; required)
Define technique scoring as **best-effort** using audio features:
- Picked note expectation:
  - require clear onset peak near note time
- Hammer/pull expectation:
  - accept pitch correctness with **reduced onset energy** (relative threshold)
- Slide expectation:
  - detect pitch glide between two pitches across time window
- Bend expectation:
  - detect monotonic pitch rise to target over window
- Mute expectation:
  - detect short, noise-like transient + rapid decay (energy envelope)

If technique detection fails:
- still allow “note hit” but reduce technique bonus (don’t hard-fail unless configured)

### Output
- Per event: `hit/miss`, `timingErrorMs`, `pitchOk`, `techOk[]`
- Per session: score %, streak, accuracy histogram, latency offset used

---

## 10) Calibration flow (auto + guided)

### Goal
Estimate `inputLatencyMs` to align detected audio events to chart time.

### Two modes
1. **Auto** (primary attempt)
   - App plays a click track (synth)
   - App listens to mic for click bleed or user strum-on-click
   - Use onset detection to measure offset between scheduled click and detected onset
   - Compute median offset across N samples

2. **Guided tap** (fallback + user-invoked)
   - User taps space / screen on the beat of metronome
   - Compute offset between expected click times and tap times
   - Use median + outlier rejection

Calibration result:
- stored per device/browser (client storage)
- attached to practice sessions

---

## 11) UX flows

### Auth + library
- Sign up / sign in
- Library page:
  - upload GP file
  - list songs
  - select song → track → level

### Practice view
- Header: song, track selector, level selector
- Controls: play/pause, seek bar, tempo (optional), calibration entry point
- Main: Pixi canvas highway
- Overlay: scoring feedback, streak, “beta chord scoring” label where relevant

### Mobile landscape
- Practice view responsive layout:
  - full-width canvas, large touch targets
  - tap areas for play/pause and calibration
  - orientation hint if portrait

---

## 12) API endpoints (Next.js Route Handlers)
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/songs`
- `POST /api/songs` (create metadata)
- `POST /api/songs/:id/upload` (multipart upload GP → MinIO; triggers parse+encode)
- `GET /api/songs/:id/tracks`
- `GET /api/songs/:id/tracks/:trackId/levels`
- `GET /api/charts/:songLevelId` (returns `chart.json` via signed URL or proxy)

**Note:** parsing/encoding can run inline for MVP; if slow, queue later.

---

## 13) Implementation milestones (agent plan)
1. Scaffold Next.js 15 app (App Router), auth pages, library shell
2. Docker + compose local with Postgres + MinIO
3. Upload pipeline: multipart upload → MinIO → Postgres metadata
4. GP parser integration: extract tracks + events
5. Chart encoder + level derivation → store charts in MinIO
6. Transport module (WebAudio clock) + SoundFont synth playback
7. Pixi renderer: lanes, notes, pooling, spawn/despawn
8. Audio capture + monophonic pitch detection + strict hit window
9. Chord beta scoring (root + strum heuristic)
10. Technique heuristic scoring (slide/bend/onset envelope)
11. Calibration (auto then guided fallback)
12. Mobile landscape layout polish

---

## 14) Deliverables
- Working MVP running via `docker-compose.local.yml`
- Production compose + Dockerfile
- Upload GP5/GPX, parse tracks, generate 7 levels
- Play + render highway + score (desktop + mobile landscape)
- Calibration flow working and persisted client-side
- Basic session scoring summary

---

## 15) Acceptance criteria
- User can sign up, upload `.gp5`/`.gpx`, see song in library
- App generates and stores 7 derived charts per track
- Practice view renders highway at stable FPS, synced with MIDI playback
- Scoring works for monophonic lines with configurable strict tolerance
- Calibration adjusts timing to improve hit accuracy
- Mobile landscape is usable (play/pause/seek/practice)