## Spec: Real-time Pitch/Note Detection Module using Spotify Basic Pitch

### 1) Objective

Implement a **real-time note/pitch detection pipeline** using **Spotify Basic Pitch** that:

* consumes microphone audio continuously,
* runs Basic Pitch inference on overlapping rolling windows,
* emits **stable** note events suitable for gameplay scoring,
* avoids audio dropouts and UI jank.

This spec is **only** for the detection layer (capture → inference → event stream). Matching/scoring against charts is out-of-scope.

---

## 2) Constraints and Design Principles

### 2.1 Hard constraints

* **Never** run inference inside an audio callback.
* Audio capture must be **glitch-free**; inference can lag or drop windows if needed.
* Must handle **device sample-rate mismatch** (usually 48kHz; Basic Pitch expects 22.05kHz internally).
* Must suppress duplicate/unstable notes across overlapping windows.

### 2.2 Target “feel”

* **Emitted note events** should arrive fast enough to be usable:

  * ideal: ≤ 250–400ms after the physical onset
  * acceptable for practice UX: ≤ 800ms
* If user hardware is slow, degrade gracefully (lower inference frequency).

---

## 3) Pipeline Overview

```
Mic → AudioWorklet (ring buffer @ device SR) → Scheduler (main thread)
   → Window extractor → Resampler → BasicPitch inference (worker)
   → Decode (notes) → De-duplication / Stabilizer → Event Bus
```

### Key decisions

* **Capture** via `AudioWorkletProcessor` into a **ring buffer** (Float32).
* **Inference** in a **WebWorker** (or main thread as fallback), never on audio thread.
* Use **rolling window inference**:

  * Window size: `W` (e.g., 0.8s or 1.0s)
  * Hop size: `H` (e.g., 0.15s–0.25s)
* Only emit events for the **tail region** of each window, then stabilize/de-dupe.

---

## 4) Configurable Parameters

### 4.1 Capture and windowing

* `deviceSampleRateHz`: from `AudioContext.sampleRate` (read-only)
* `windowSec (W)`: default `0.8` (range: 0.5–1.2)
* `hopSec (H)`: default `0.2` (range: 0.1–0.3)
* `tailEmitSec (T)`: default `H` (emit only last hop interval)
* `maxBacklog`: default `2` windows
  If inference falls behind and backlog > maxBacklog, drop oldest windows.

### 4.2 Resampling

* `modelSampleRateHz`: `22050`
* Resampler must produce Float32 PCM at 22050Hz.
* Allowed implementations:

  * `OfflineAudioContext` resample (simple, but some overhead)
  * custom polyphase/linear resampler (faster, more work)

### 4.3 Decoder thresholds (Basic Pitch → notes)

Your implementation must support changing these **without redeploying**:

* `onsetThresh`: default `0.25` (tune per environment)
* `frameThresh`: default `0.25`
* `minNoteLenSec`: default `0.10` (important for fast notes; don’t keep 0.12+ hardcoded)
* `inferPolyphonic`: boolean

  * Phase 1: `false` (monophonic output only) recommended for robustness
  * Phase 2+: `true` (poly) optional

> Note: Basic Pitch libraries differ in exposed knobs; if the JS wrapper doesn’t expose everything, implement a local post-processing layer that enforces `minNoteLenSec` and thresholds.

---

## 5) Audio Capture (AudioWorklet)

### 5.1 Requirements

* Implement `MicCaptureWorkletProcessor`:

  * input: 1 channel (mono)
  * push PCM frames into a ring buffer shared with main thread
* Use `SharedArrayBuffer` if available for zero-copy (preferred).
* Fallback: postMessage chunks (acceptable, higher overhead).

### 5.2 Ring buffer contract

* Ring buffer stores the **last N seconds** of audio.
* `bufferSec`: must be ≥ `W + 0.5` (default 2.0s)
* Provide atomic indices:

  * `writeIndex` monotonically increases (samples written)
  * main thread reads `[writeIndex - W*sr, writeIndex)` when scheduling inference

### 5.3 Failure modes

* If mic permission denied: emit `DetectionState = "disabled"` with reason.
* If buffer underrun: skip window.

---

## 6) Scheduler (Main Thread)

### 6.1 Scheduling loop

* A timer ticks at `hopSec` cadence (using `setInterval` or RAF-driven clock).
* At each tick:

  1. Check `writeIndex` has enough samples for a full `W` window.
  2. Extract window samples (Float32) from ring buffer.
  3. Resample to 22050.
  4. Dispatch inference request to worker with:

     * `windowId`
     * `windowStartTimeMs` (absolute mic timebase)
     * PCM data at 22050
     * decoder settings snapshot

### 6.2 Timebase handling

Maintain a monotonic “mic timeline”:

* At start, record:

  * `audioCtxStartTime` (AudioContext time)
  * `startWriteIndex`
* Convert sample index → ms:

  * `tMs = (sampleIndex - startWriteIndex) / deviceSampleRateHz * 1000`

This is critical for aligning note timestamps to playback later.

### 6.3 Backpressure

* Maintain `inflight` count.
* If `inflight >= maxBacklog`: drop this tick’s request or replace oldest pending (configurable).
* Emit telemetry: `droppedWindows++`.

---

## 7) Inference Worker

### 7.1 Worker responsibilities

* Load Basic Pitch model once and reuse.
* Accept `InferRequest`:

  * `pcm22050: Float32Array`
  * `windowStartTimeMs`
  * params
* Run inference and decode notes.
* Return `InferResponse`:

  * `windowId`
  * `windowStartTimeMs`
  * `windowDurationMs`
  * `notes: DetectedNote[]` (relative or absolute timestamps)
  * optional: `raw` (frames/onsets/contours) only if needed for debugging

### 7.2 Notes format (required fields)

`DetectedNote`:

* `pitchMidi: number`
* `startMs: number` (absolute mic timeline)
* `endMs: number` (absolute mic timeline)
* `amplitude: number` (0..1 or 0..127; define consistently)
* `confidence: number` (0..1) if available, else omit
* `source: "basicpitch"`

### 7.3 Tail filtering (in worker or main)

Compute the tail region:

* `tailStartMs = windowStartTimeMs + (W - T)*1000`
* Only return notes that **start** within `[tailStartMs, windowEndMs]`

  * plus optionally include notes that started earlier but overlap tail (config `includeOverlaps`)

Default:

* `includeOverlaps = true` (helps sustained notes)
* Mark overlapped notes with `isContinuation=true`

---

## 8) Stabilization and De-duplication (Main Thread)

Rolling windows will produce duplicates and shifting boundaries. Implement a **note tracker** that merges events across responses.

### 8.1 Active note state

Maintain `activeByPitch: Map<pitchMidi, ActiveNoteState>`

`ActiveNoteState`:

* `pitchMidi`
* `lastSeenWindowId`
* `startMs` (candidate)
* `endMs` (latest)
* `peakAmplitude`
* `stabilityCount` (# of consecutive windows confirming)
* `emittedNoteOn: boolean`

### 8.2 Merge algorithm

For each `DetectedNote n` from worker:

1. Find active `a = activeByPitch[n.pitchMidi]`
2. If none: create new active with `startMs=n.startMs`, `endMs=n.endMs`, `stabilityCount=1`
3. If exists:

   * If `n.startMs` is within `mergeStartToleranceMs` of `a.startMs` OR overlaps:

     * merge: `a.endMs = max(a.endMs, n.endMs)`
     * `a.peakAmplitude = max(a.peakAmplitude, n.amplitude)`
     * `a.stabilityCount++`
   * Else treat as new note (close old, start new)

Recommended tolerances:

* `mergeStartToleranceMs`: 80ms
* `gapCloseToleranceMs`: 60ms (if end-to-next-start gap small, merge)

### 8.3 Emitting stable events

Emit events onto an internal event bus:

* Emit `note_on` when:

  * `stabilityCount >= 2` **OR**
  * `amplitude >= strongAmplitudeThreshold` (fast-path for clear attacks)
* Emit `note_off` when:

  * note not seen for `missesToClose` windows (default 2), or endMs sufficiently behind current time

Events:

* `NoteOn`:

  * `pitchMidi`, `timeMs`, `velocity/amplitude`, `id`
* `NoteOff`:

  * `id`, `timeMs`

### 8.4 Handling legato / weak onsets

Basic Pitch may represent pitch changes without clean onsets. You must:

* emit `pitch_change` events if a new pitch appears while a prior pitch is still active and overlaps heavily.
* OR allow “silent note-ons” when stability confirms even if amplitude weak.

Config:

* `allowLegatoNoteOn=true`
* `legatoStabilityWindows=3` (more conservative)

---

## 9) Output Interface (Public API)

Expose a detector module with:

### 9.1 Lifecycle

* `init(): Promise<void>` loads worklet + worker + model
* `start(): Promise<void>` requests mic and begins scheduling
* `stop(): void` stops mic + timers
* `setConfig(partialConfig): void` hot-updates thresholds/windowing (applies next window)

### 9.2 Events

Provide subscription methods:

* `on("note_on", handler)`
* `on("note_off", handler)`
* `on("pitch_change", handler)` (optional)
* `on("telemetry", handler)` (latency, backlog, dropped windows)
* `on("state", handler)` (enabled/disabled/error)

### 9.3 Telemetry payload

* `avgInferMs`, `p95InferMs`
* `windowsPerSec`
* `droppedWindows`
* `currentLatencyMs` (estimated: now - emitted note start)

---

## 10) Quality Controls and Practical Modes

### 10.1 Monophonic first (recommended)

For “single-string / melody” levels:

* force monophonic output:

  * keep only highest-confidence pitch at a time
  * or keep one active pitch and suppress others
    This dramatically reduces false positives.

### 10.2 Polyphonic mode (later)

When `inferPolyphonic=true`:

* cap polyphony: `maxSimulNotes=3` (initially)
* require higher confidence / stability for additional simultaneous notes
* still run dedupe + stability per pitch

### 10.3 Noise/rejection gates

Before inference, compute quick energy RMS on the window:

* If RMS < `silenceThreshold`, skip inference (saves CPU, reduces junk)

---

## 11) Default Parameter Set (Baseline)

Good starting defaults for desktop browsers:

* `W=0.8s`
* `H=0.2s`
* `T=0.2s`
* `maxBacklog=2`
* `mergeStartToleranceMs=80`
* `missesToClose=2`
* `onsetThresh=0.25`, `frameThresh=0.25`
* `minNoteLenSec=0.10`
* `inferPolyphonic=false`
* `silenceThresholdRms=0.005` (tune)

---

## 12) Acceptance Criteria

1. **No audio glitches** while detection runs for 5 minutes on a typical desktop.
2. Detector emits `note_on` events in response to single notes with:

   * median latency ≤ 500ms (with defaults)
   * p95 latency ≤ 900ms
3. Duplicate `note_on` for the same sustained note is **< 5%** (after dedupe).
4. Configuration updates (thresholds/window) apply without restarting capture.
5. Under CPU stress, detector **drops windows** rather than stuttering audio thread.

---

## 13) Implementation Notes (Agent Guidance)

* Prefer **worker inference** (model + decode) and keep main thread for scheduling + UI.
* Don’t assume any fixed sample rate; treat `AudioContext.sampleRate` as truth.
* If `SharedArrayBuffer` is unavailable (COOP/COEP not set), implement message-based chunk buffering and increase hop slightly to compensate overhead.
* Keep a debug mode that logs:

  * inferred notes per window
  * dedupe merges
  * dropped windows
  * timings

---

If you want, I can add a **minimal message schema** (`InferRequest/InferResponse` JSON types) and a **state-machine diagram** for the dedupe/stabilizer (it’s usually where most bugs happen).


---
---
# REFINEMENT

Below are the **amendments** to apply to the existing detection spec  to support your refactor:


## A) Global, documented config file

### A1. Requirement

Create a **single global config module** that defines *all* tunables used by the detection pipeline (windowing, decoding, polyphony limits, dedupe/stability, RMS gating, backpressure, telemetry). This becomes the only source of truth.

### A2. Location and ownership

* **File**: `src/config/pitchDetection.config.ts` (or equivalent in your repo structure)
* Must export:

  * `PitchDetectionConfigSchema` (Zod)
  * `defaultPitchDetectionConfig`
  * `loadPitchDetectionConfig()` (merges env overrides; validates with Zod)
  * `setPitchDetectionConfig(partial)` (runtime updates; emits config-changed event)

### A3. Configuration model

Config must be **documented inline** (JSDoc) and must include:

* **Windowing**

  * `windowSec`, `hopSec`, `tailEmitSec`, `bufferSec`
* **Backpressure**

  * `maxBacklog`, `dropPolicy: "drop_oldest" | "skip_tick"`
* **Resampling**

  * `modelSampleRateHz` (fixed 22050), `resampler: "offlineAudioContext" | "custom"`
* **Decoder / extraction**

  * `onsetThresh`, `frameThresh`, `minNoteLenSec`
  * `includeOverlaps`, `emitTailOnly`
* **Polyphony**

  * `polyphonicEnabled: true`
  * `maxSimulNotes`, `polyphonyConfidenceGate`, `polyphonyStabilityWindows`
* **De-dupe / stabilizer**

  * `mergeStartToleranceMs`, `gapCloseToleranceMs`, `missesToClose`
  * `strongAmplitudeThreshold`, `allowLegatoNoteOn`, `legatoStabilityWindows`
* **Noise gating**

  * `silenceThresholdRms`, `silenceSkipWindows: boolean`
* **Telemetry**

  * `metricsEnabled`, `metricsRingSize`, `metricsEmitIntervalMs`

### A4. Override rules

* Allow overrides via env (Next.js runtime constraints apply—prefer server-provided config or build-time env):

  * `PITCHDET_WINDOW_SEC`, etc.
* **Validation**: app must refuse to start detection if config invalid (emit state error + reason).
* **Runtime updates**: `setConfig()` must write into the global config store and apply on **next scheduler tick** (never mid-audio callback).

---

## B) Polyphonic detection is implemented now

The prior “polyphonic later” language  must be replaced with **polyphonic as default behavior**, with explicit controls.

### B1. Pipeline behavior changes

* Worker inference must always run the polyphonic decoder path.
* Output must include potentially multiple simultaneous notes per time slice.
* The stabilizer must track **multiple active notes concurrently**, not “one active pitch”.

### B2. Updated note tracking state

Replace `activeByPitch: Map<pitchMidi, ActiveNoteState>` with:

* `activeByPitch: Map<number, ActiveNoteState>` (still OK) **plus**
* `activeFrameIndex` (optional): for quick “currently sounding set” computation
* Add to `ActiveNoteState`:

  * `lastStartMsObserved` (for onset jitter)
  * `lastEndMsObserved`
  * `confidenceEMA` (optional smoothing)
  * `isChordMember: boolean` (derived; not required for scoring but useful for debug)

### B3. Polyphony limits and gating

Implement these rules (all config-driven):

1. **Cap** simultaneous active notes at `maxSimulNotes` (default 3–4).
2. When more than cap are detected in a window tail:

   * Rank candidates by `(confidence, amplitude, stabilityCount)` and keep top N.
3. Require additional notes (beyond the strongest one) to satisfy:

   * `confidence >= polyphonyConfidenceGate`
   * `stabilityCount >= polyphonyStabilityWindows` (default 2–3)

### B4. Duplicate suppression across windows (critical)

With polyphony, duplicates increase. Extend merge rules:

* A detected note `n` merges into active `a` if:

  * `pitch` matches AND
  * time overlaps OR `|n.startMs - a.startMs| <= mergeStartToleranceMs` OR `gap <= gapCloseToleranceMs`
* If a pitch reappears with a clearly different start time (beyond tolerance), close old + open new.

### B5. Event bus changes

Continue emitting:

* `note_on`, `note_off`, optional `pitch_change`

Add (optional but recommended for polyphony debugging):

* `active_notes` snapshot event at a throttled cadence (e.g., every 100ms):

  * list of currently active pitches + amplitudes/confidences

---

## C) Store and display metrics in the existing Debug View

The prior “telemetry event” section  should be expanded into a concrete **metrics subsystem** that both:

* stores time-series samples (ring buffer), and
* exposes them to the Debug View.

### C1. Metrics store (client-side)

Implement `PitchDetectionMetricsStore`:

* In-memory ring buffers (fixed-size arrays) for:

  * `inferMs` (per window)
  * `resampleMs` (per window)
  * `decodeMs` (per window)
  * `schedulerLagMs` (difference between expected tick time and actual)
  * `inflightCount`
  * `droppedWindows` (counter)
  * `rms` (per window)
  * `notesEmittedCount` (per window)
  * `activeNoteCount` (sampled)
  * `noteOnLatencyMs` (estimated: emitTime - note.startMs)
* All controlled by config:

  * `metricsEnabled`
  * `metricsRingSize` (e.g., 600 samples)
  * `metricsEmitIntervalMs` (e.g., 250–500ms)

### C2. Metrics emission contract

Detector must periodically publish a **single aggregated snapshot** for the Debug View:

* `DetectionMetricsSnapshot`:

  * `tsMs`
  * `avgInferMs`, `p95InferMs` (computed over last N)
  * `avgNoteOnLatencyMs`, `p95NoteOnLatencyMs`
  * `windowsPerSec`
  * `inflight`
  * `droppedWindowsTotal`
  * `rmsAvg`
  * `activeNotesNow`
  * `notesEmittedPerSec`

### C3. Debug View requirements

Update the existing debug UI to show:

1. **Health strip**

   * state (running / disabled / error)
   * inflight, dropped windows, windows/sec
2. **Performance charts** (time series)

   * infer ms, decode ms, scheduler lag
3. **Signal charts**

   * RMS over time
   * active note count
4. **Live notes panel**

   * active notes (pitch names + MIDI + confidence/amplitude)
   * last N emitted `note_on` events with latency and timestamps

### C4. Optional persistence

If you already persist debug logs, add optional persistence of metrics snapshots:

* Persist only aggregated snapshots (not raw PCM / not raw model tensors).
* Sampling interval >= 250ms to avoid bloat.

---

## D) Acceptance criteria updates (polyphony + debug)

Replace the monophonic-oriented checks  with:

1. **No audio glitches** for 5 minutes while polyphonic detection runs.
2. **Polyphony sanity**: when strumming a simple open chord, active note count should typically be within `1..maxSimulNotes` and not explode (>8) for sustained periods.
3. **Duplicate suppression**: for a sustained chord, repeated `note_on` duplicates per pitch should be **< 10%** (polyphony is harder than mono; tune as needed).
4. Debug View shows:

   * rolling infer/decode timings,
   * backlog/dropped windows,
   * note latency percentiles,
   * current active notes.

