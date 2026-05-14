/** Must match `public/worklets/audio-capture-processor.js` FFT_N. */
export const RECOGNITION_FFT_SIZE = 2048;

const SPEC_BINS = RECOGNITION_FFT_SIZE / 2 + 1;

/** Linear magnitude sum in ±halfSemitones around centerHz (positive-frequency bins only). */
export function sumBandMagnitudes(
  spectrum: Float32Array,
  sampleRate: number,
  centerHz: number,
  halfSemitones: number,
): number {
  if (centerHz <= 0 || spectrum.length < SPEC_BINS) return 0;
  const lo = centerHz * Math.pow(2, -halfSemitones / 12);
  const hi = centerHz * Math.pow(2, halfSemitones / 12);
  let k0 = Math.floor((lo * RECOGNITION_FFT_SIZE) / sampleRate);
  let k1 = Math.ceil((hi * RECOGNITION_FFT_SIZE) / sampleRate);
  k0 = Math.max(1, k0);
  k1 = Math.min(spectrum.length - 1, k1);
  if (k1 < k0) return 0;
  let s = 0;
  for (let k = k0; k <= k1; k++) s += spectrum[k];
  return s;
}

/** Sum magnitudes ~65 Hz–5 kHz for normalization (guitar-ish band). */
export function spectrumBandEnergySum(spectrum: Float32Array, sampleRate: number): number {
  const k0 = Math.max(1, Math.floor((65 * RECOGNITION_FFT_SIZE) / sampleRate));
  const k1 = Math.min(spectrum.length - 1, Math.ceil((5000 * RECOGNITION_FFT_SIZE) / sampleRate));
  if (k1 < k0) return 0;
  let s = 0;
  for (let k = k0; k <= k1; k++) s += spectrum[k];
  return s;
}

/** Crude MIDI estimate from strongest bin in guitar band (wrong-note hint). */
export function inferMidiFromSpectrum(spectrum: Float32Array, sampleRate: number): number | null {
  const k0 = Math.max(1, Math.floor((65 * RECOGNITION_FFT_SIZE) / sampleRate));
  const k1 = Math.min(spectrum.length - 1, Math.ceil((5000 * RECOGNITION_FFT_SIZE) / sampleRate));
  if (k1 < k0) return null;
  let bestK = k0;
  let best = spectrum[k0];
  for (let k = k0 + 1; k <= k1; k++) {
    if (spectrum[k] > best) {
      best = spectrum[k];
      bestK = k;
    }
  }
  if (best < 1e-10) return null;
  const hz = (bestK * sampleRate) / RECOGNITION_FFT_SIZE;
  return 69 + 12 * Math.log2(hz / 440);
}
