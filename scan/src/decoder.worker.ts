/**
 * The QR decoder: zxing-wasm in a Web Worker. The WebAssembly file is loaded from the
 * verifier's own origin. The content of a QR code that is not a stamp is counted and discarded here,
 * so that it never reaches the page.
 */

import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import { isStampText, type DecodeRequest, type WorkerMessage } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

const WASM = new URL("zxing_reader.wasm", self.location.href).href;

const ready = prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? WASM : prefix + path) },
  fireImmediately: true,
});

const post = (message: WorkerMessage, transfer: Transferable[] = []) => self.postMessage(message, transfer);

/** Camera frames: fast enough for several frames per second, thorough enough for a version 27 code. */
const CAMERA: ReaderOptions = {
  formats: ["QRCode"],
  textMode: "Plain",
  tryHarder: true,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 8,
};

/** Images and pages: every code on the image, at any orientation. */
const FILE: ReaderOptions = { ...CAMERA, tryRotate: true, tryInvert: true, maxNumberOfSymbols: 255 };

/** A second attempt on an image in which nothing was found: noise removal for photographs. */
const FILE_DENOISE: ReaderOptions = { ...FILE, tryDenoise: true };

async function decode(request: DecodeRequest): Promise<void> {
  await ready;
  const image = new ImageData(new Uint8ClampedArray(request.data), request.width, request.height);
  let results = await readBarcodes(image, request.mode === "camera" ? CAMERA : FILE);
  if (results.length === 0 && request.mode === "file") results = await readBarcodes(image, FILE_DENOISE);
  const stamps: string[] = [];
  let others = 0;
  for (const r of results) {
    if (!r.isValid) continue;
    if (isStampText(r.text)) stamps.push(r.text);
    else others++;
  }
  post({ type: "result", id: request.id, stamps, others });
}

ready.then(
  () => post({ type: "ready" }),
  (e: unknown) => post({ type: "failed", message: e instanceof Error ? e.message : String(e) }),
);

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  decode(event.data).catch((e: unknown) => post({ type: "error", id: event.data.id, message: e instanceof Error ? e.message : String(e) }));
};
