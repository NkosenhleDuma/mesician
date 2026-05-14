# Note Recognition V2 — Scoring-First, Mobile-Friendly

Companion to `NOTE_RECOGNITION.md`. The original doc is a good MIR survey but is framed around open-ended transcription. Mesician already has ground truth from `chart.json`, runs in the browser (including mobile), and needs verdicts that align with `±35/80/150 ms` timing windows. This doc rewrites the approach around those constraints.

## 0. Goals and constraints

- Target platform: modern browsers, including mid-range mobile (Android Chrome, iOS Safari 16+).
- Real-time: end-to-end mic-to-verdict latency must fit inside the existing scoring windows in `src/lib/scoring/engine.ts`:
  - `perfect: 35 ms`
  - `slight: 80 ms`
  - `off: 150 ms`
- CPU budget on mobile: a few percent of one core. No CNN/AMT models, no per-frame TFJS inference.
- Memory: small (KB, not MB). No large model weights.
- Battery: avoid `requestAnimationFrame`-based polling for DSP; use `AudioWorklet`.
- Network: zero. Everything runs locally.
- Existing types are authoritative: `ChartEvent`, `NoteHit`, `Verdict`, `ScoreState`. The recognizer feeds these; it does not replace them.

## 1. Core principle — verify, don't recognize

We always know what is expected next. The recognizer's job is not "what chord is this?" — it is:

> Within a short window around an expected event, is there sufficient evidence for each expected MIDI note, and not too much energy at clearly wrong pitches?

That single reframing removes the need for:

- Open-ended chord classifiers (chord templates, Viterbi over a chord vocabulary).
- Polyphonic transcription models (Basic Pitch, CREPE, MT3).
- Long stabilization windows (250–500 ms) that would break timing scoring.

Everything below follows from this.

## 2. Pipeline

```
mic (getUserMedia, mono, no AEC/NS/AGC)
  ↓
AudioWorklet @ 48 kHz, hop 512  (≈10.7 ms per hop)
  ↓
pre-process: DC-block, light high-pass (~60 Hz), RMS gate
  ↓
spectral frame (STFT, N = 2048, Hann)         ── shared buffer
  ↓                                              ↓
onset detector (spectral flux)              feature cache:
  ↓                                            - magnitude spectrum
  ↓ onset event (t_onset, strength)            - band energies at expected fundamentals
  ↓                                              - YIN f0 + confidence (mono only)
scoring scheduler
  ↓
  for each pending ChartEvent within ±VERDICT_WINDOWS_MS.off of t_onset:
    ↓
    branch A (mono event, 1 expected note):
        YIN-based verification + cents error
    branch B (poly event, >1 expected notes):
        per-note harmonic energy match (matched filter)
  ↓
NoteHit[] → existing engine (applyVerdictToScore)
```

Key differences from V1:

- Onsets drive scoring, not animation frames.
- Spectrum is computed once per hop and shared by mono and poly branches.
- "Mono vs poly" is decided by the **expected event**, not by a classifier on the audio.

## 3. Mobile DSP budget

Hard numbers we design against:

| Knob | Value | Why |
| --- | --- | --- |
| Sample rate | 48 kHz (whatever `AudioContext` gives, do not resample) | Avoid resample cost on mobile |
| Window size | 2048 samples (~42.7 ms) | Enough resolution for low E2 (~82 Hz) |
| Hop size | 512 samples (~10.7 ms) | 4× overlap; ~93 hops/sec |
| FFT | One real FFT per hop, size 2048 | ~10 µs–200 µs on mobile JS |
| YIN | Only on mono events, only inside the candidate window | Avoids YIN every hop |
| Memory | < 256 KB total ring buffers + spectra | Mobile safe |

Rule of thumb: if we touch every hop we do *cheap* work (FFT, flux, band energies). Expensive work (YIN, full per-note matched filter) only runs on **onset-triggered windows** that overlap a pending `ChartEvent`.

This is what keeps it mobile-viable.

## 4. Input capture

- `getUserMedia` constraints already in `PracticeClient.tsx` are correct: `echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1`. Keep them.
- Move the actual sampling out of `AnalyserNode + requestAnimationFrame` and into an `AudioWorkletNode`. `AnalyserNode.getFloatTimeDomainData` returns the *most recent* buffer, not a contiguous stream — fine for visualization, bad for DSP that needs every sample.
- On iOS Safari, `AudioContext.sampleRate` is commonly 48000 but may be 44100. Don't hard-code; read at startup.
- Provide a fallback `ScriptProcessor` path only for very old browsers; do not optimize for it.

## 5. Onset detection (spectral flux)

Per hop, compute:

```
flux_t = sum_k max(0, |X_t[k]| - |X_{t-1}[k]|)
```

Then:

- Normalize by a moving median (window ~1 s) to get an adaptive threshold.
- An onset fires when `flux_t > threshold` and a local-max condition holds, with a refractory period (~50 ms) to avoid double-firing on a single strum.
- Each onset carries `(t_onset, strength)`; `strength` later helps reject string noise.

Why spectral flux: cheap, robust on guitar, mobile-friendly. Avoid HFC/complex-domain methods initially — they don't pay off for the cost.

Result: scoring fires on attacks, never on sustain. That is also what makes "two consecutive E notes" countable.

## 6. Mono pitch — lightweight YIN

For `ChartEvent` with exactly one expected note, run YIN on a single buffer centered ~20 ms after the onset.

Practical YIN for mobile:

- Use the **difference function + cumulative mean normalized difference function (CMNDF)** from the original YIN paper — skip pYIN/Viterbi. We don't need probabilistic smoothing because we have an expected pitch already.
- Restrict the lag search to a band around the expected fundamental: `lag_expected = sampleRate / f_expected`, search `±2 semitones` worth of lags. This cuts YIN cost by ~10–20× on mono events.
- Output `(f0, aperiodicity)`. Reject if `aperiodicity > 0.2`.

Then:

- `midi = 69 + 12 * log2(f0 / 440)`
- `cents = 1200 * log2(f0 / f_expected)`
- `pitchOk = |cents| <= 50` (start at 50, expose as setting later).

This replaces the current naive autocorrelation in `src/lib/scoring/pitch.ts` and fixes its octave-error bias on low strings.

## 7. Polyphonic verification — matched harmonic energy

For `ChartEvent` with multiple expected notes (chord, dyad, power chord, partial voicings, any tab voicing), do *not* try to label it as a chord.

Per expected note `n` with MIDI `m_n`:

1. Compute expected fundamental `f_n` and a small harmonic set, e.g. `{f_n, 2 f_n, 3 f_n, 4 f_n}`.
2. For each harmonic, sum spectral magnitude in a narrow bin band: `±0.5` semitones around the harmonic frequency.
3. Weight harmonics with a decaying profile (e.g. `[1.0, 0.6, 0.4, 0.25]`) — guitar fundamentals are often weaker than harmonic 2.
4. The note's **support score** is the weighted sum, normalized by total spectral energy in the analysis window.
5. `pitchOk` if support score exceeds a per-note threshold and the note's f0 bin is not clearly dominated by a non-expected pitch from the chart's tuning grid.

Why this is the right tool for tab-driven scoring:

- It works for *any* voicing the tab specifies (Em7 open, drop-D power chord, 2-string dyad, root-fifth-octave). No chord-name vocabulary.
- It is cheap: ~4 spectral bins per expected note. A 6-note chord costs ~24 bin lookups.
- It naturally yields per-note `pitchOk`, which the existing `NoteHit` struct already carries.
- It degrades gracefully on partial chords: missing notes show low support; present notes still register.

What it does **not** give you:

- True per-string attribution from a single mic. Guitar strings overlap heavily in pitch (e.g. fret 5 of low E = open A). We accept this and rely on the chart's expected string set for assignment, exactly as the current code already does via `openStringMidi`.

## 8. Strum spread

Guitar chords arrive staggered over 30–80 ms. To match the strum, not the first hit:

- After an onset, keep accumulating bin energies for `~120 ms` before computing per-note support.
- If another onset fires inside that window with similar spectral signature, fold it into the same analysis instead of starting a new event.
- For sweeps/arpeggios written as separate `ChartEvent`s, the refractory period (Section 5) and per-event matching handle them naturally.

## 9. Integration with the existing scoring engine

Touch points should stay tight:

- `src/lib/scoring/pitch.ts`: replace `estimatePitch` with a lightweight YIN, plus a new `noteSupport(spectrum, midi, sampleRate)` helper for the poly branch. Keep `tuningMidis` and `openStringMidi` — they are correct.
- `src/lib/scoring/engine.ts`: `scoreEventAtTime` becomes `scoreEventOnOnset(ev, t_onset, frame, spectrum, sampleRate, latencyMs)`. Inputs change; outputs (`ScoreEventResult`, `NoteHit`, `Verdict`) stay the same so `applyVerdictToScore` is untouched.
- `src/components/practice/PracticeClient.tsx`: replace the `requestAnimationFrame` mic loop with an `AudioWorkletNode` that posts:
  - `onset` messages (t, strength)
  - on demand, `frame` messages (raw buffer + magnitude spectrum) for the worklet's current window
  - The main thread keeps the same event-pairing logic (find pending events within `winSec`) but reacts to onsets instead of polling.

Backward compatibility: keep `Verdict`, `VERDICT_WINDOWS_MS`, `VERDICT_POINTS`, and `ScoreState` exactly as they are. The recognizer changes; the scoring math does not.

## 10. What we explicitly avoid

Do not adopt these for V2:

| Idea | Why we avoid it |
| --- | --- |
| Basic Pitch / `@spotify/basic-pitch` in real time | CNN+HCQT, designed for offline; too heavy on mobile; latency exceeds our windows |
| CREPE / CREPE.js | Same: ML pitch on every frame is mobile-hostile |
| Full chroma + chord-template classifier | Wrong abstraction; tab gives us exact notes, not chord names |
| pYIN with Viterbi smoothing across frames | Smoothing window collides with timing windows |
| 250–500 ms chord stabilization | Breaks `±35/80/150 ms` verdicts |
| Resampling to 16 kHz / 22.05 kHz | Sample-rate conversion in JS is wasted budget |
| `AnalyserNode` as the DSP source | Drops samples, not contiguous; fine for visuals only |
| Heavy onset detectors (complex-domain, NN-based) | Spectral flux is enough for guitar onsets |
| String-level pitch attribution from audio alone | Physically ambiguous; rely on chart context |

## 11. Mobile-specific notes

- **iOS Safari**: `AudioContext` must be created/resumed inside a user gesture. The existing `acquireMic` already does this; keep that pattern when wiring the worklet.
- **Background tab throttling**: `AudioWorklet` keeps running in many browsers, but `requestAnimationFrame`-coupled UI updates do not. Decouple scoring from rAF — it should run from worklet messages.
- **Low-end Android**: Worst-case FFT-per-hop budget matters. If profiling shows pressure, drop hop to 1024 (~21 ms) before sacrificing window size; pitch resolution matters more than time resolution for verification.
- **Headphones / built-in mic**: built-in mics on phones often have aggressive default EQ. The `echoCancellation/noiseSuppression/autoGainControl: false` constraints are essential and already set.
- **Bluetooth mics**: SCO profile is 8 kHz mono — unusable for pitch. Detect via `AudioContext.sampleRate < 16000` and warn.

## 12. Calibration

- Keep `latencyMs` from `src/lib/calibration/storage.ts`. Apply it on the timing-error side (it already is) — onsets carry true `t_onset`, the verdict math subtracts latency.
- Provide a calibration screen later: play a click, expect the user to tap; mic records the click coming back; measure round-trip → store as `latencyMs`. Lightweight.

## 13. Implementation stages

Stage 1 — Foundation (mobile-ready)
- `AudioWorklet` capture, contiguous frames, RMS gate.
- Spectral flux onset detector with adaptive threshold.
- Wire onsets into the existing event matcher in `PracticeClient.tsx`.

Stage 2 — Mono accuracy
- Lightweight, band-restricted YIN replacing `estimatePitch`.
- Cents-error output in `NoteHit`.
- Keep monophonic exercises working end-to-end, on mobile.

Stage 3 — Constrained polyphonic verification
- `noteSupport()` helper using STFT bins + harmonic weights.
- Per-note `pitchOk` for multi-note `ChartEvent`s.
- Strum-spread aggregation window.

Stage 4 — Polish
- Adaptive thresholds per song/user (auto-tune based on a few seconds of playing).
- Optional cents-aware visual feedback in the highway.
- Calibration screen for latency.

Each stage is shippable on its own and incrementally improves scoring quality without ever introducing an ML model or a non-real-time dependency.

## 14. Open risks

- **Very low strings (drop tunings, 7-string)**: 2048-sample window may be marginal for B0/A0. If we ever support those, bump window to 4096 with hop 1024 in low-tuning mode only.
- **Acoustic guitar with strong sympathetic resonance**: open strings can ring after a chord change. Decay-aware suppression may be needed in Stage 4.
- **Distorted electric guitar via mic**: harmonic content is non-canonical; harmonic-weight profile may need a "distorted" preset.
- **Room reverb on phones**: spectral flux can over-fire in reverberant rooms; the moving-median threshold mostly handles it, but extreme cases may need a higher RMS gate.

## 15. Summary

V2 is V1 inverted: instead of a general recognition stack with scoring bolted on top, it is a scoring stack with the minimum recognition needed to support it. Concretely, this means:

- Onset-triggered, not frame-polled.
- Spectrum computed once per hop, reused by both branches.
- YIN only on mono events, in a narrow lag band.
- Matched harmonic-energy check, not chord templates, for poly events.
- No ML, no AMT, no long smoothing — everything fits the existing timing windows.
- All of it runs in an `AudioWorklet` on mid-range mobile.
