/**
 * Main-thread loader for `public/worklets/audio-capture-processor.js`.
 */

const MODULE_PATH = "/worklets/audio-capture-processor.js";

const modulePromises = new WeakMap<AudioContext, Promise<void>>();

export async function ensureAudioCaptureWorklet(ctx: AudioContext): Promise<void> {
  let p = modulePromises.get(ctx);
  if (!p) {
    const url =
      typeof window !== "undefined"
        ? new URL(MODULE_PATH, window.location.origin).href
        : MODULE_PATH;
    p = ctx.audioWorklet.addModule(url).catch((err: unknown) => {
      modulePromises.delete(ctx);
      throw err;
    });
    modulePromises.set(ctx, p);
  }
  return p;
}

export type OnsetPayload = {
  audioContextTime: number;
  currentFrame: number;
  sampleRate: number;
  rms: number;
  /** Spectral flux at this hop (normalized threshold compare) */
  flux?: number;
  /** Adaptive flux threshold active at onset */
  fluxThreshold?: number;
  spectrum: Float32Array;
  waveSnippet: Float32Array;
  /** Samples written counter from worklet (for debugging / sync). */
  writeTotal?: number;
};

export type PcmTailPayload = {
  pcm: Float32Array;
  writeTotal: number;
  audioCtxTime: number;
  sampleRate: number;
};

export type OnsetHandler = (payload: OnsetPayload) => void;

/** Mic / file → AudioWorkletNode (no outputs); forwards onset messages to handler. */
export class AudioCaptureWorklet {
  private node: AudioWorkletNode | null = null;

  private streamSource: MediaStreamAudioSourceNode | null = null;

  private inputNodeOwner: AudioNode | null = null;

  private hearGain: GainNode | null = null;

  private handler: OnsetHandler | null = null;

  private readonly boundOnMessage: (ev: MessageEvent) => void;

  private pcmReqId = 0;

  private readonly pendingPcm = new Map<
    number,
    { resolve: (v: PcmTailPayload) => void; reject: (e: Error) => void; to: number }
  >();

  constructor(private readonly ctx: AudioContext) {
    this.boundOnMessage = this.onPortMessage.bind(this);
  }

  private onPortMessage(ev: MessageEvent): void {
    const d = ev.data as Record<string, unknown>;
    const type = d?.type;
    if (type === "pcmTail") {
      const id = d.id as number;
      const pending = this.pendingPcm.get(id);
      if (!pending || typeof id !== "number") return;
      window.clearTimeout(pending.to);
      this.pendingPcm.delete(id);

      const pcm = d.pcm as Float32Array | undefined;
      const writeTotal = d.writeTotal as number | undefined;
      const audioCtxTime = d.audioCtxTime as number | undefined;
      const sr = d.sampleRate as number | undefined;
      if (!(pcm instanceof Float32Array)) {
        pending.reject(new Error("invalid pcmTail"));
        return;
      }
      if (
        typeof writeTotal !== "number" ||
        typeof audioCtxTime !== "number" ||
        typeof sr !== "number"
      ) {
        pending.reject(new Error("invalid pcmTail metadata"));
        return;
      }

      pending.resolve({ pcm, writeTotal, audioCtxTime, sampleRate: sr });
      return;
    }

    if (type !== "onset" || !(d.spectrum instanceof Float32Array) || !(d.waveSnippet instanceof Float32Array)) {
      return;
    }
    if (
      typeof d.audioContextTime !== "number" ||
      typeof d.sampleRate !== "number" ||
      typeof d.rms !== "number" ||
      typeof d.currentFrame !== "number"
    ) {
      return;
    }
    const writeTotal =
      typeof d.writeTotal === "number" ? d.writeTotal : undefined;
    this.handler?.({
      audioContextTime: d.audioContextTime,
      currentFrame: d.currentFrame,
      sampleRate: d.sampleRate,
      rms: d.rms,
      flux: typeof d.flux === "number" ? d.flux : undefined,
      fluxThreshold: typeof d.fluxThreshold === "number" ? d.fluxThreshold : undefined,
      spectrum: d.spectrum,
      waveSnippet: d.waveSnippet,
      writeTotal,
    });
  }

  /** Request contiguous mono PCM from the processor ring (recent tail). May block until worklet replies. */
  requestPcmTail(samples: number, timeoutMs = 1500): Promise<PcmTailPayload> {
    if (!this.node) return Promise.reject(new Error("capture not connected"));
    return new Promise((resolve, reject) => {
      const id = ++this.pcmReqId;
      const to = window.setTimeout(() => {
        this.pendingPcm.delete(id);
        reject(new Error("pcmTail timeout"));
      }, timeoutMs);
      this.pendingPcm.set(id, {
        resolve,
        reject,
        to,
      });
      this.node!.port.postMessage({ type: "getPcmTail", id, samples });
    });
  }

  setOnsetHandler(handler: OnsetHandler | null): void {
    this.handler = handler;
  }

  async connect(stream: MediaStream): Promise<void> {
    await ensureAudioCaptureWorklet(this.ctx);
    this.disconnect();
    const node = new AudioWorkletNode(this.ctx, "audio-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    node.port.onmessage = this.boundOnMessage;
    const src = this.ctx.createMediaStreamSource(stream);
    src.connect(node);
    this.node = node;
    this.streamSource = src;
    this.inputNodeOwner = null;
    this.hearGain = null;
  }

  /**
   * Feed capture from any mono audio node (e.g. MediaElementSource for debug file input).
   * When `monitorGain` > 0, duplicates the signal to `monitorDestination` so the user hears playback.
   */
  async connectFromNode(
    source: AudioNode,
    monitor?: { gain: number; destination: AudioNode },
  ): Promise<void> {
    await ensureAudioCaptureWorklet(this.ctx);
    this.disconnect();
    const node = new AudioWorkletNode(this.ctx, "audio-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    node.port.onmessage = this.boundOnMessage;
    source.connect(node);
    this.node = node;
    this.streamSource = null;
    this.inputNodeOwner = source;
    if (monitor && monitor.gain > 0) {
      const g = this.ctx.createGain();
      g.gain.value = monitor.gain;
      source.connect(g);
      g.connect(monitor.destination);
      this.hearGain = g;
    } else {
      this.hearGain = null;
    }
  }

  disconnect(): void {
    for (const [, p] of this.pendingPcm.entries()) {
      window.clearTimeout(p.to);
      p.reject(new Error("capture disconnected"));
    }
    this.pendingPcm.clear();

    const node = this.node;
    if (node) {
      node.port.onmessage = null;
    }

    if (this.streamSource && node) {
      try {
        this.streamSource.disconnect(node);
      } catch {
        /* ignore */
      }
    }
    if (this.inputNodeOwner && node) {
      try {
        this.inputNodeOwner.disconnect(node);
      } catch {
        /* ignore */
      }
    }
    if (this.inputNodeOwner && this.hearGain) {
      try {
        this.inputNodeOwner.disconnect(this.hearGain);
      } catch {
        /* ignore */
      }
    }
    if (this.hearGain) {
      try {
        this.hearGain.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (node) {
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (this.streamSource) {
      try {
        this.streamSource.disconnect();
      } catch {
        /* ignore */
      }
    }

    this.node = null;
    this.streamSource = null;
    this.inputNodeOwner = null;
    this.hearGain = null;
  }
}
