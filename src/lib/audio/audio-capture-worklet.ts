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

/** Mic → AudioWorkletNode (no outputs); forwards onset messages to handler. */
export class AudioCaptureWorklet {
  private node: AudioWorkletNode | null = null;

  private source: MediaStreamAudioSourceNode | null = null;

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
    this.source = src;
  }

  disconnect(): void {
    for (const [, p] of this.pendingPcm.entries()) {
      window.clearTimeout(p.to);
      p.reject(new Error("capture disconnected"));
    }
    this.pendingPcm.clear();
    if (this.node) {
      this.node.port.onmessage = null;
      try {
        this.node.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.node = null;
    this.source = null;
  }
}
