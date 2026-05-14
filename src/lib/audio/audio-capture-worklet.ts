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
};

export type OnsetHandler = (payload: OnsetPayload) => void;

/** Mic → AudioWorkletNode (no outputs); forwards onset messages to handler. */
export class AudioCaptureWorklet {
  private node: AudioWorkletNode | null = null;

  private source: MediaStreamAudioSourceNode | null = null;

  private handler: OnsetHandler | null = null;

  private readonly boundOnMessage: (ev: MessageEvent) => void;

  constructor(private readonly ctx: AudioContext) {
    this.boundOnMessage = this.onPortMessage.bind(this);
  }

  private onPortMessage(ev: MessageEvent): void {
    const d = ev.data as {
      type?: string;
      audioContextTime?: number;
      currentFrame?: number;
      sampleRate?: number;
      rms?: number;
      flux?: number;
      fluxThreshold?: number;
      spectrum?: Float32Array;
      waveSnippet?: Float32Array;
    };
    if (d?.type !== "onset" || !d.spectrum || !d.waveSnippet) return;
    if (
      typeof d.audioContextTime !== "number" ||
      typeof d.sampleRate !== "number" ||
      typeof d.rms !== "number" ||
      typeof d.currentFrame !== "number"
    ) {
      return;
    }
    this.handler?.({
      audioContextTime: d.audioContextTime,
      currentFrame: d.currentFrame,
      sampleRate: d.sampleRate,
      rms: d.rms,
      flux: typeof d.flux === "number" ? d.flux : undefined,
      fluxThreshold: typeof d.fluxThreshold === "number" ? d.fluxThreshold : undefined,
      spectrum: d.spectrum,
      waveSnippet: d.waveSnippet,
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
