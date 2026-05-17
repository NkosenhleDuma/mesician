import type { BpInferRequest, BpWorkerInbound, BpWorkerOutbound } from "@/lib/detection/types";

export type BasicPitchWorkerClientOptions = {
  modelUrl: string;
  wasmBaseUrl: string;
  preferBackend: "wasm" | "webgl";
};

export type InferJob = Omit<BpInferRequest, "type">;

/** Wraps bundled module worker lifecycle (create on client after user gesture preferred). */
export class BasicPitchWorkerClient {
  private worker: Worker | null = null;

  private inferSeq = 0;

  constructor(private readonly options: BasicPitchWorkerClientOptions) {}

  async ensureWorker(): Promise<Worker> {
    if (!this.worker) {
      const w = new Worker(new URL("./basic-pitch.worker.ts", import.meta.url), { type: "module" });
      this.worker = w;
      await new Promise<void>((resolve, reject) => {
        const onReady = (ev: MessageEvent<BpWorkerOutbound>) => {
          const d = ev.data;
          if (d?.type === "ready") {
            cleanup();
            resolve();
          } else if (d?.type === "error") {
            cleanup();
            reject(new Error(d.message));
          }
        };
        const onErr = (e: ErrorEvent) => {
          cleanup();
          reject(e.error ?? new Error(String(e.message)));
        };
        const cleanup = () => {
          w.removeEventListener("message", onReady);
          w.removeEventListener("error", onErr);
        };
        w.addEventListener("message", onReady);
        w.addEventListener("error", onErr);
        const initMsg: Extract<BpWorkerInbound, { type: "init" }> = {
          type: "init",
          modelUrl: this.options.modelUrl,
          wasmBaseUrl: this.options.wasmBaseUrl,
          preferBackend: this.options.preferBackend,
        };
        w.postMessage(initMsg);
      });
    }
    return this.worker;
  }

  async infer(job: Omit<InferJob, "windowId"> & { windowId?: number }): Promise<Extract<BpWorkerOutbound, { type: "inferResult" }>> {
    const w = await this.ensureWorker();
    const windowId = job.windowId ?? ++this.inferSeq;
    return new Promise((resolve, reject) => {
      const onMsg = (ev: MessageEvent<BpWorkerOutbound>) => {
        const d = ev.data;
        if (d?.type === "inferResult" && d.windowId === windowId) {
          cleanup();
          resolve(d);
        } else if (d?.type === "error") {
          cleanup();
          reject(new Error(d.message));
        }
      };
      const onErr = (e: ErrorEvent) => {
        cleanup();
        reject(e.error ?? new Error(String(e.message)));
      };
      const cleanup = () => {
        w.removeEventListener("message", onMsg);
        w.removeEventListener("error", onErr);
      };
      w.addEventListener("message", onMsg);
      w.addEventListener("error", onErr);

      const pcmCopy = job.pcm.buffer.byteLength === job.pcm.byteLength ? job.pcm.slice() : job.pcm;

      const msg: BpWorkerInbound = {
        type: "infer",
        windowId,
        pcm: pcmCopy,
        decoding: job.decoding,
        windowEndCtxSec: job.windowEndCtxSec,
      };
      w.postMessage(msg, [pcmCopy.buffer]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
