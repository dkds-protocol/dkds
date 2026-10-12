/**
 * The page's side of the QR decoder in decoder.worker.ts.
 */

import type { DecodeRequest, Decoded, WorkerMessage } from "./protocol.ts";

export type { Decoded } from "./protocol.ts";

/** Raised when the decoder cannot be started. */
export class DecoderUnavailable extends Error {}

/** The decoder: one worker, started on first use and kept for the life of the page. */
export class Decoder {
  private worker: Worker | undefined;
  private started: Promise<void> | undefined;
  private next = 1;
  private readonly pending = new Map<number, { resolve: (d: Decoded) => void; reject: (e: Error) => void }>();

  /** Starts the worker and loads the WebAssembly module. Rejects with {@link DecoderUnavailable}. */
  start(): Promise<void> {
    this.started ??= new Promise<void>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL("./decoder.js", document.baseURI), { type: "module" });
      } catch (e) {
        reject(new DecoderUnavailable(e instanceof Error ? e.message : String(e)));
        return;
      }
      this.worker = worker;
      worker.onerror = (event) => {
        event.preventDefault();
        this.fail(new DecoderUnavailable(event.message || "The decoder could not be loaded."), reject);
      };
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === "ready") resolve();
        else if (message.type === "failed") this.fail(new DecoderUnavailable(message.message), reject);
        else {
          const waiting = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.type === "result") waiting?.resolve({ stamps: message.stamps, others: message.others });
          else waiting?.reject(new Error(message.message));
        }
      };
    });
    return this.started;
  }

  /** Decodes an image. The image's pixel buffer is transferred to the worker and is unusable afterwards. */
  async decode(image: ImageData, mode: "camera" | "file"): Promise<Decoded> {
    await this.start();
    const id = this.next++;
    const data = image.data.buffer as ArrayBuffer;
    return new Promise<Decoded>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const request: DecodeRequest = { id, mode, width: image.width, height: image.height, data };
      this.worker!.postMessage(request, [data]);
    });
  }

  private fail(error: Error, reject: (e: Error) => void): void {
    reject(error);
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = undefined;
    this.started = undefined;
  }
}
