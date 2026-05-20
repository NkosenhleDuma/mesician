import {
  midiMatchesEvidence,
  MONO_CENTS_TOLERANCE,
  noteHarmonicSupport,
  YIN_CMNDF_MAX,
} from "@/lib/scoring/recognize";
import {
  inferMidiFromSpectrum,
  spectrumBandEnergySum,
} from "@/lib/scoring/spectrum";
import { midiToFreq } from "@/lib/audio/midi-to-freq";
import { hzToMidi } from "@/lib/scoring/pitch";
import { yinAroundExpected } from "@/lib/scoring/yin";

const SEMI_TOL = 0.55;

export type VerifyCalibrationPitchResult = {
  ok: boolean;
  detectedMidi: number | null;
  cents: number | null;
  harmonicSupport: number;
};

export function verifyCalibrationPitch(
  expectedMidi: number,
  waveSnippet: Float32Array,
  spectrum: Float32Array,
  sampleRate: number,
  evidenceMidis?: Set<number> | null,
): VerifyCalibrationPitchResult {
  const norm = spectrumBandEnergySum(spectrum, sampleRate);
  const normSafe = norm > 1e-12 ? norm : 1e-12;
  const harmonicSupport = noteHarmonicSupport(spectrum, sampleRate, expectedMidi, normSafe);

  if (evidenceMidis != null && evidenceMidis.size > 0) {
    const ok = midiMatchesEvidence(expectedMidi, evidenceMidis, SEMI_TOL);
    let detectedMidi = inferMidiFromSpectrum(spectrum, sampleRate);
    if (detectedMidi == null) {
      const sorted = [...evidenceMidis].sort((a, b) => a - b);
      detectedMidi = sorted[Math.floor(sorted.length / 2)]!;
    }
    const cents =
      detectedMidi != null ? 1200 * Math.log2(midiToFreq(detectedMidi) / midiToFreq(expectedMidi)) : null;
    return { ok, detectedMidi, cents, harmonicSupport };
  }

  const expectedHz = midiToFreq(expectedMidi);
  const y = yinAroundExpected(waveSnippet, sampleRate, expectedHz, 2);
  const cmOk = y != null && y.cmndfMin <= YIN_CMNDF_MAX;
  let detectedMidi: number | null = y != null ? hzToMidi(y.hz) : null;
  let cents: number | null = y != null ? 1200 * Math.log2(y.hz / midiToFreq(expectedMidi)) : null;

  if (cmOk && y != null && cents != null && Math.abs(cents) <= MONO_CENTS_TOLERANCE) {
    return { ok: true, detectedMidi, cents, harmonicSupport };
  }

  const coarse = inferMidiFromSpectrum(spectrum, sampleRate);
  if (
    coarse != null &&
    Math.abs(coarse - expectedMidi) <= SEMI_TOL &&
    harmonicSupport >= 1e-6
  ) {
    detectedMidi = coarse;
    cents = 1200 * Math.log2(midiToFreq(coarse) / midiToFreq(expectedMidi));
    return { ok: true, detectedMidi, cents, harmonicSupport };
  }

  return {
    ok: false,
    detectedMidi,
    cents,
    harmonicSupport,
  };
}
