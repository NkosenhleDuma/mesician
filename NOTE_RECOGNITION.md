Practical answer

Use two classifiers, not one:

Monophonic note detector for single notes
Best for lead lines, singing, one guitar string, exercises.
Polyphonic/chord detector for multiple simultaneous notes
Best for strummed guitar, piano-like audio, chord recognition.

Trying to force one algorithm to handle both cleanly usually gives worse results.

1. Audio pipeline
microphone audio
  ↓
resample / mono / normalize
  ↓
noise gate + onset detection
  ↓
branch A: note detection
branch B: chord detection
  ↓
temporal smoothing
  ↓
confidence scoring
  ↓
app-level output: note / chord / unknown

Recommended input format:

sample rate: 44.1 kHz or 48 kHz
channels: mono
frame size: 2048–4096 samples
hop size: 256–1024 samples
window: Hann

For real-time guitar use, start with:

sample rate: 48 kHz
frame size: 2048
hop size: 512

That gives acceptable latency while still having usable pitch resolution.

2. Single-note detection

For monophonic notes, estimate fundamental frequency, then map frequency to MIDI note.

Use algorithms like:

Algorithm	Use case
YIN / pYIN	Good general monophonic pitch detection
CREPE	ML-based pitch detection, often strong but heavier
autocorrelation	Simple, fast, less robust
FFT peak picking	Fast but easily fooled by harmonics
librosa.pyin is a good offline/reference implementation. It estimates F0 using pYIN and Viterbi smoothing.

Frequency → MIDI note:

function frequencyToMidi(frequency: number): number {
  return Math.round(69 + 12 * Math.log2(frequency / 440));
}

function midiToNoteName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = names[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

For example:

440 Hz → A4
261.63 Hz → C4
329.63 Hz → E4

Add cents error:

function centsOff(frequency: number, midi: number): number {
  const target = 440 * Math.pow(2, (midi - 69) / 12);
  return 1200 * Math.log2(frequency / target);
}

This lets you classify:

A4, +7 cents
C4, -12 cents

rather than only "A" or "C".

3. Chord detection

For chords, do not try to find one fundamental frequency. A chord has multiple notes, and guitar chords contain strong overtones that can confuse F0 detectors.

Use chroma features instead.

Chroma compresses audio into 12 pitch classes:

C, C#, D, D#, E, F, F#, G, G#, A, A#, B

So a C major chord should produce strong energy around:

C, E, G

Libraries:

Library	Use
Essentia	Strong MIR/audio-analysis toolkit
librosa	Good Python research/prototyping
Basic Pitch	ML-based audio-to-MIDI transcription
custom CQT/chroma + templates	Good for app-specific chord classifier
Essentia has a ChordsDetection algorithm that estimates chords from harmonic pitch class profiles and outputs labels like A, Bb, G#m, etc. librosa.feature.chroma_cqt is useful for building a custom chroma-based chord recognizer.
4. Simple chord classifier

Represent each chord as a 12-bit-ish template.

Example: C major

C major = C E G
         = [1,0,0,0,1,0,0,1,0,0,0,0]

A minor:

A minor = A C E
         = [1,0,0,0,1,0,0,0,0,1,0,0]

Then compare the live chroma vector against every chord template.

Pseudo-code:

type ChordTemplate = {
  name: string;
  vector: number[]; // length 12
};

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, x, i) => sum + x * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, x) => sum + x * x, 0));
  const magB = Math.sqrt(b.reduce((sum, x) => sum + x * x, 0));

  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

function classifyChord(chroma: number[], templates: ChordTemplate[]) {
  let best = { name: 'unknown', score: 0 };

  for (const template of templates) {
    const score = cosineSimilarity(chroma, template.vector);
    if (score > best.score) {
      best = { name: template.name, score };
    }
  }

  if (best.score < 0.65) {
    return { chord: 'unknown', confidence: best.score };
  }

  return { chord: best.name, confidence: best.score };
}

Start with only these chord families:

major
minor
dominant 7
major 7
minor 7
sus2
sus4
power chord / 5 chord

Do not start by trying to classify every extended jazz chord. You will get noisy, unstable labels.

5. Better option for polyphonic notes: audio-to-MIDI

For guitar exercises, the best middle ground may be:

audio → detected notes/MIDI → app scoring logic

Spotify’s Basic Pitch is a lightweight open-source automatic music transcription model. It supports polyphonic instruments and works best on one instrument at a time, which matches a guitar-practice app reasonably well.

This gives you output closer to:

time=0.12s note=E3 velocity=0.72
time=0.13s note=G3 velocity=0.68
time=0.14s note=B3 velocity=0.65

Then your app can infer:

E minor chord

from the detected notes.

For your Yousician-like guitar app, I would treat Basic Pitch or a similar AMT model as a polyphonic scoring backend, not just a chord-labeler.

6. Smoothing matters a lot

Raw frame-by-frame detection will flicker:

C → C → Am → C → unknown → C

You need temporal smoothing.

Use:

minimum duration: 80–150 ms for notes
minimum duration: 250–500 ms for chords

Example logic:

class StableLabel<T> {
  private candidate: T | null = null;
  private candidateSince = 0;
  private current: T | null = null;

  constructor(private minMs: number) {}

  update(label: T, nowMs: number): T | null {
    if (label !== this.candidate) {
      this.candidate = label;
      this.candidateSince = nowMs;
      return this.current;
    }

    if (nowMs - this.candidateSince >= this.minMs) {
      this.current = label;
    }

    return this.current;
  }
}

This alone can make classification feel much more “musical”.

7. Recommended architecture for your app
MVP
For single notes:
  microphone → pYIN/YIN → MIDI note → cents error → stable note

For chords:
  microphone → CQT/chroma → chord templates → stable chord

Good enough for:

single-note exercises
basic open chords
power chords
major/minor chord recognition
rough strum timing
Better version
microphone → Basic Pitch / AMT model → active MIDI notes
                                      ↓
                              chord inference
                                      ↓
                              scoring engine

This is better for:

partial chords
wrong-string detection
arpeggios
polyphonic guitar input
chord voicings
timing accuracy
Best long-term version
microphone
  ↓
onset detector
  ↓
polyphonic transcription model
  ↓
known exercise/tab context
  ↓
expected notes/chords comparison
  ↓
score: timing, pitch, sustain, missed notes, extra notes

The key point: use the exercise context. If the app knows the expected chord is G major, classification becomes much easier than open-ended chord recognition.

8. Important scoring distinction

Do not ask:

“What chord is this audio?”

Ask:

“Does this audio match the expected chord/note at this point in the exercise?”

That lets you use constrained classification:

Expected: C major
Accept: C/E, C/G, partial C, slightly late C
Reject: D major, A minor, muted/noisy input

This is much more robust for a learning app.

9. Guitar-specific improvements

For guitar input, add these:

Problem	Fix
Harmonics mistaken for notes	Prefer AMT/chroma over FFT peaks
Open strings ringing	Add decay-aware note tracking
Muted strums	Classify as percussive/no-pitch event
Slight tuning drift	Allow ±25 cents initially
Chord inversions	Use pitch-class matching, not exact bass note
Noise from mic	Use onset gating and minimum energy thresholds
Strummed chords are staggered	Accumulate notes over 100–250 ms

For guitar chords, do not require all notes to start at the exact same timestamp. A strum is naturally spread over time.

10. My recommended path

For your app, I’d implement this in stages:

Stage 1:
  monophonic pitch detection for single-note lessons

Stage 2:
  chroma-template chord detection for basic chords

Stage 3:
  Basic Pitch / AMT-based note extraction for polyphonic scoring

Stage 4:
  expected-tab-aware scoring engine

The biggest quality jump will come from moving from:

open-ended audio classification

to:

expected exercise-aware classification

That lets the app behave much more like a guitar tutor rather than a generic music transcription system.