/**
 * Reading stamps from a file: an image, or the pages of a PDF file.
 */

import type { Decoder } from "./decoder.ts";
import { openPicture, pixels } from "./image.ts";
import { MAX_PAGES, openPdf, type PasswordPrompt } from "./pdf.ts";
import { Cancelled, Problem } from "./problem.ts";
import type { FoundStamp } from "./verify.ts";

/** The largest file read, in bytes. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** What was read from a file. */
export interface FileReading {
  readonly kind: "image" | "pdf";
  readonly stamps: readonly FoundStamp[];
  /** The number of QR codes that are not stamps. */
  readonly others: number;
  /** For a PDF file: the pages read and the pages in the file. */
  readonly pagesRead?: number;
  readonly pageCount?: number;
}

/** Progress of a reading, for the display. */
export type Progress = { readonly step: "pdf-library" } | { readonly step: "page"; readonly page: number; readonly of: number };

export interface ReadOptions {
  readonly decoder: Decoder;
  readonly signal: AbortSignal;
  readonly onProgress: (progress: Progress) => void;
  readonly askPassword: PasswordPrompt;
}

const IMAGE_SIGNATURES: readonly (readonly number[])[] = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x42, 0x4d], // BMP
  [0x52, 0x49, 0x46, 0x46], // RIFF (WebP)
];

/** The kind of a file, from its first bytes, its media type and its name, in this order. */
function kindOf(head: Uint8Array, file: File): "image" | "pdf" | undefined {
  const starts = (sig: readonly number[]) => sig.every((b, i) => head[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46])) return "pdf";
  if (IMAGE_SIGNATURES.some(starts)) return "image";
  // ISO base media files (HEIC, HEIF, AVIF) carry "ftyp" at offset 4.
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return "image";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type.startsWith("image/") || /\.(heic|heif|avif|tiff?)$/i.test(file.name)) return "image";
  return undefined;
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new Cancelled();
}

/** Adds the stamps of one image to `stamps`, merging repeated stamps. */
function collect(stamps: Map<string, number[]>, texts: readonly string[], page: number): void {
  for (const text of texts) {
    const pages = stamps.get(text);
    if (pages === undefined) stamps.set(text, page ? [page] : []);
    else if (page && !pages.includes(page)) pages.push(page);
  }
}

const found = (stamps: Map<string, number[]>): FoundStamp[] => [...stamps].map(([text, pages]) => ({ text, pages }));

/** Reads the stamps of a file. Throws a {@link Problem} or {@link Cancelled}. */
export async function readFile(file: File, options: ReadOptions): Promise<FileReading> {
  const name = file.name || "the file";
  if (file.size === 0) throw new Problem("file-empty", { name });
  if (file.size > MAX_FILE_BYTES) throw new Problem("file-too-large", { name });
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const kind = kindOf(head, file);
  if (kind === undefined) throw new Problem("file-type", { name });
  checkSignal(options.signal);
  return kind === "pdf" ? readPdf(file, name, options) : readImage(file, name, options);
}

async function readImage(file: File, name: string, { decoder, signal }: ReadOptions): Promise<FileReading> {
  const picture = await openPicture(file, name);
  try {
    checkSignal(signal);
    let result = await decoder.decode(pixels(picture), "file");
    // A small image of a dense code has too few pixels per module; it is enlarged and read again.
    const side = Math.max(picture.width, picture.height);
    if (result.stamps.length === 0 && result.others === 0 && side < 1200) {
      checkSignal(signal);
      result = await decoder.decode(pixels(picture, Math.ceil(1600 / side)), "file");
    }
    checkSignal(signal);
    const stamps = new Map<string, number[]>();
    collect(stamps, result.stamps, 0);
    return { kind: "image", stamps: found(stamps), others: result.others };
  } finally {
    picture.close();
  }
}

async function readPdf(file: File, name: string, { decoder, signal, onProgress, askPassword }: ReadOptions): Promise<FileReading> {
  const data = await file.arrayBuffer();
  const pdf = await openPdf(data, name, askPassword, () => onProgress({ step: "pdf-library" }));
  try {
    const pagesRead = Math.min(pdf.pageCount, MAX_PAGES);
    const stamps = new Map<string, number[]>();
    let others = 0;
    for (let n = 1; n <= pagesRead; n++) {
      checkSignal(signal);
      onProgress({ step: "page", page: n, of: pagesRead });
      const result = await decoder.decode(await pdf.page(n), "file");
      collect(stamps, result.stamps, n);
      others += result.others;
    }
    checkSignal(signal);
    return { kind: "pdf", stamps: found(stamps), others, pagesRead, pageCount: pdf.pageCount };
  } finally {
    pdf.close();
  }
}
