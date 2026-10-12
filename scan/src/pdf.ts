/**
 * PDF files: pdf.js, loaded when the first PDF file is opened. Pages are rendered at 300
 * dots per inch and passed to the QR decoder. At most 50 pages are read.
 */

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { MAX_PIXELS, release } from "./image.ts";
import { Cancelled, Problem } from "./problem.ts";

/** The number of pages read from one file. */
export const MAX_PAGES = 50;
const DPI = 300;

type PdfJs = typeof import("pdfjs-dist");

let library: Promise<PdfJs> | undefined;

/** Loads pdf.js from the verifier's origin. Throws a {@link Problem} "pdf-unavailable". */
function loadLibrary(): Promise<PdfJs> {
  library ??= (async () => {
    const url = new URL("pdf/pdf.min.mjs", document.baseURI).href;
    const pdfjs = (await import(url)) as PdfJs;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf/pdf.worker.min.mjs", document.baseURI).href;
    return pdfjs;
  })().catch(() => {
    library = undefined;
    throw new Problem("pdf-unavailable");
  });
  return library;
}

/**
 * Asks the reader for a password. Resolves to the password, or to null when the reader declines.
 * `incorrect` is true after a wrong password.
 */
export type PasswordPrompt = (incorrect: boolean) => Promise<string | null>;

/** An opened PDF file. */
export interface Pdf {
  readonly pageCount: number;
  /** Renders a page, numbered from 1, and returns its pixels. */
  page(n: number): Promise<ImageData>;
  close(): void;
}

/** Opens a PDF file. Throws a {@link Problem} or, when the reader declines a password, {@link Cancelled}. */
export async function openPdf(data: ArrayBuffer, name: string, askPassword: PasswordPrompt, onLoadingLibrary: () => void): Promise<Pdf> {
  onLoadingLibrary();
  const pdfjs = await loadLibrary();
  const task: PDFDocumentLoadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    wasmUrl: new URL("pdf/wasm/", document.baseURI).href,
    iccUrl: new URL("pdf/iccs/", document.baseURI).href,
    useWorkerFetch: true,
    enableXfa: false,
    verbosity: 0,
  });
  let declined = false;
  task.onPassword = (update: (password: string) => void, reason: number) => {
    askPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD).then((password) => {
      if (password === null) {
        declined = true;
        void task.destroy();
      } else update(password);
    });
  };
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch {
    if (declined) throw new Cancelled();
    throw new Problem("pdf-unreadable", { name });
  }
  return {
    pageCount: doc.numPages,
    page: (n) => renderPage(doc, n),
    close: () => void task.destroy(),
  };
}

async function renderPage(doc: PDFDocumentProxy, n: number): Promise<ImageData> {
  const page = await doc.getPage(n);
  try {
    const size = page.getViewport({ scale: 1 });
    const scale = Math.min(DPI / 72, Math.sqrt(MAX_PIXELS / (size.width * size.height)));
    const viewport = page.getViewport({ scale });
    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    try {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("The browser did not provide a canvas.");
      await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" }).promise;
      return context.getImageData(0, 0, width, height);
    } finally {
      release(canvas);
    }
  } finally {
    page.cleanup();
  }
}
