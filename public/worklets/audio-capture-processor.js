/**
 * Mesician mic capture + spectral-flux onset detector (NOTE_RECOGNITION_V2).
 * FFT_N=2048, hop=512, ~93 hops/sec @ 48 kHz.
 * Includes a PCM ring (~2.7s @ 48kHz) for Basic Pitch window extraction.
 */

const FFT_N = 2048;
const HOP = 512;
const SPEC_BINS = FFT_N / 2 + 1;
const STRUM_SPREAD_HOPS = 12;
const FLUX_HIST_LEN = 96;
const REFRACTORY_SAMPLES_DEFAULT = Math.round(48000 * 0.05);
const MEDIAN_THRESHOLD_FACTOR = 2.35;
const RMS_GATE_DEFAULT = 0.014;
/** Mono ring depth (samples); power-of-two for fast modulo (~2.73s @ 48kHz) */
const PCM_RING_LEN = 131072;

function reverseBits(i, bits) {
  let rev = 0;
  let x = i;
  for (let z = 0; z < bits; z++) {
    rev = (rev << 1) | (x & 1);
    x >>= 1;
  }
  return rev;
}

/** In-place radix-2 Cooley-Tukey FFT; real/imag length FFT_N power of two */
function fftRadix2(real, imag) {
  const n = real.length;
  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) {
    const j = reverseBits(i, bits);
    if (j > i) {
      let t = real[i];
      real[i] = real[j];
      real[j] = t;
      t = imag[i];
      imag[i] = imag[j];
      imag[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >>> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepRe = Math.cos(angle);
    const wStepIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < halfLen; j++) {
        const k = i + j + halfLen;
        const tre = wRe * real[k] - wIm * imag[k];
        const tim = wRe * imag[k] + wIm * real[k];
        const ure = real[i + j];
        const uim = imag[i + j];
        real[k] = ure - tre;
        imag[k] = uim - tim;
        real[i + j] = ure + tre;
        imag[i + j] = uim + tim;
        const nwRe = wRe * wStepRe - wIm * wStepIm;
        const nwIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nwRe;
        wIm = nwIm;
      }
    }
  }
}

function medianScratch(scratch, len) {
  scratch.sort((a, b) => a - b);
  return scratch[(len - 1) >> 1];
}

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** @type {Float32Array} */
    this.ring = new Float32Array(PCM_RING_LEN);
    /** Monotonic samples written (may exceed ring; index with % PCM_RING_LEN) */
    this.writeTotal = 0;
    this.samplesSinceHop = 0;
    this.hpPrevIn = 0;
    this.hpPrevOut = 0;
    /** HP ~75 Hz */
    const fc = 75;
    const dt = 1 / sampleRate;
    const rc = 1 / (2 * Math.PI * fc);
    this.hpAlpha = rc / (rc + dt);

    this.hann = new Float32Array(FFT_N);
    for (let i = 0; i < FFT_N; i++) {
      this.hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_N - 1)));
    }

    this.fftReal = new Float32Array(FFT_N);
    this.fftImag = new Float32Array(FFT_N);
    /** @type {Float32Array | null} */
    this.prevMag = null;
    this.fluxHist = new Float32Array(FLUX_HIST_LEN);
    this.fluxHistIdx = 0;
    this.fluxHistFilled = 0;
    this.prevFlux = 0;

    this.specSlots = [];
    for (let i = 0; i < STRUM_SPREAD_HOPS; i++) {
      this.specSlots.push(new Float32Array(SPEC_BINS));
    }
    this.specSlotIdx = 0;
    this.specSlotsFilled = 0;

    this.lastOnsetSampleFrame = -Infinity;
    this.refractorySamples = REFRACTORY_SAMPLES_DEFAULT;

    this.port.onmessage = (ev) => {
      const d = ev.data;
      if (d?.type === "config") {
        if (typeof d.rmsGate === "number") this.rmsGate = d.rmsGate;
        if (typeof d.medianThresholdFactor === "number") this.medianThresholdFactor = d.medianThresholdFactor;
        return;
      }
      if (d?.type === "getPcmTail") {
        const req =
          typeof d.samples === "number" && Number.isFinite(d.samples) ? Math.floor(d.samples) : 0;
        const n = Math.max(0, Math.min(req, PCM_RING_LEN));
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const wt = this.writeTotal - n + i;
          if (wt < 0 || this.writeTotal === 0) {
            out[i] = 0;
          } else {
            const ringIdx = ((wt % PCM_RING_LEN) + PCM_RING_LEN) % PCM_RING_LEN;
            out[i] = this.ring[ringIdx] ?? 0;
          }
        }
        const frameNow = this.currentCtxFrame();
        const audioCtxTime =
          typeof globalThis.currentTime === "number" ? globalThis.currentTime : frameNow / sampleRate;
        this.port.postMessage(
          {
            type: "pcmTail",
            id: d.id,
            pcm: out,
            writeTotal: this.writeTotal,
            audioCtxTime,
            sampleRate,
          },
          [out.buffer],
        );
      }
    };

    this.rmsGate = RMS_GATE_DEFAULT;
    this.medianThresholdFactor = MEDIAN_THRESHOLD_FACTOR;

    /** Scratch for median — reuse array */
    this.medianTmp = [];
  }

  extractWindow(rawOut) {
    for (let i = 0; i < FFT_N; i++) {
      const wt = this.writeTotal - FFT_N + i;
      if (wt < 0) {
        rawOut[i] = 0;
        continue;
      }
      rawOut[i] = this.ring[wt % PCM_RING_LEN];
    }
  }

  computeFluxAndMag(rawWin, magOut) {
    let rms = 0;
    for (let i = 0; i < FFT_N; i++) {
      const x = rawWin[i];
      rms += x * x;
    }
    rms = Math.sqrt(rms / FFT_N);

    for (let i = 0; i < FFT_N; i++) {
      this.fftReal[i] = rawWin[i] * this.hann[i];
      this.fftImag[i] = 0;
    }
    fftRadix2(this.fftReal, this.fftImag);

    magOut[0] = Math.abs(this.fftReal[0]);
    for (let k = 1; k < FFT_N / 2; k++) {
      const re = this.fftReal[k];
      const im = this.fftImag[k];
      magOut[k] = Math.sqrt(re * re + im * im);
    }
    magOut[FFT_N / 2] = Math.abs(this.fftReal[FFT_N / 2]);

    if (!this.prevMag) {
      this.prevMag = new Float32Array(SPEC_BINS);
      this.prevMag.set(magOut);
      return { flux: 0, rms };
    }

    let flux = 0;
    for (let k = 0; k < SPEC_BINS; k++) {
      const dMag = magOut[k] - this.prevMag[k];
      if (dMag > 0) flux += dMag;
    }
    this.prevMag.set(magOut);
    return { flux, rms };
  }

  pushFluxHist(flux) {
    this.fluxHist[this.fluxHistIdx] = flux;
    this.fluxHistIdx = (this.fluxHistIdx + 1) % FLUX_HIST_LEN;
    if (this.fluxHistFilled < FLUX_HIST_LEN) this.fluxHistFilled++;
  }

  fluxMedianThreshold() {
    const len = this.fluxHistFilled;
    if (len < 8) return Infinity;
    this.medianTmp.length = 0;
    if (len < FLUX_HIST_LEN) {
      for (let i = 0; i < len; i++) this.medianTmp.push(this.fluxHist[i]);
    } else {
      for (let j = 0; j < FLUX_HIST_LEN; j++) {
        const i = (this.fluxHistIdx + j) % FLUX_HIST_LEN;
        this.medianTmp.push(this.fluxHist[i]);
      }
    }
    const med = medianScratch(this.medianTmp, this.medianTmp.length);
    return Math.max(med * this.medianThresholdFactor, 1e-8);
  }

  aggregateSpecsInto(dst) {
    dst.fill(0);
    const nUse = Math.min(this.specSlotsFilled, STRUM_SPREAD_HOPS);
    for (let s = 0; s < nUse; s++) {
      const slot = this.specSlots[s];
      for (let k = 0; k < SPEC_BINS; k++) {
        const v = slot[k];
        if (v > dst[k]) dst[k] = v;
      }
    }
  }

  /** Total frames rendered since AudioContext start */
  currentCtxFrame() {
    return globalThis.currentFrame;
  }

  /**
   * @param {Float32Array | undefined} input
   */
  processHop() {
    const rawWin = new Float32Array(FFT_N);
    this.extractWindow(rawWin);

    const slot = this.specSlots[this.specSlotIdx];
    const { flux, rms } = this.computeFluxAndMag(rawWin, slot);

    this.specSlotIdx = (this.specSlotIdx + 1) % STRUM_SPREAD_HOPS;
    if (this.specSlotsFilled < STRUM_SPREAD_HOPS) this.specSlotsFilled++;

    this.pushFluxHist(flux);
    const thresh = this.fluxMedianThreshold();

    const frameNow = this.currentCtxFrame();
    const refractoryOk = frameNow - this.lastOnsetSampleFrame >= this.refractorySamples;

    const peakish = flux > this.prevFlux && flux >= thresh;
    this.prevFlux = flux;

    if (peakish && refractoryOk && rms >= this.rmsGate) {
      this.lastOnsetSampleFrame = frameNow;

      const aggMag = new Float32Array(SPEC_BINS);
      this.aggregateSpecsInto(aggMag);

      const waveSnippet = new Float32Array(FFT_N);
      waveSnippet.set(rawWin);

      const audioCtxTime =
        typeof globalThis.currentTime === "number" ? globalThis.currentTime : frameNow / sampleRate;

      this.port.postMessage(
        {
          type: "onset",
          audioContextTime: audioCtxTime,
          currentFrame: frameNow,
          sampleRate,
          rms,
          flux,
          fluxThreshold: thresh,
          spectrum: aggMag,
          waveSnippet,
          writeTotal: this.writeTotal,
        },
        [aggMag.buffer, waveSnippet.buffer],
      );
    }
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;

    const sr = sampleRate;
    this.refractorySamples = Math.round(sr * 0.05);

    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const y = this.hpAlpha * (this.hpPrevOut + x - this.hpPrevIn);
      this.hpPrevIn = x;
      this.hpPrevOut = y;

      const idx = this.writeTotal % PCM_RING_LEN;
      this.ring[idx] = y;
      this.writeTotal++;

      this.samplesSinceHop++;
      if (this.samplesSinceHop >= HOP) {
        this.samplesSinceHop = 0;
        this.processHop();
      }
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
