/**
 * Image files to pixels. Images are decoded by the browser, so that every format it supports can be
 * read, with the orientation recorded in the file applied.
 */

import { Problem } from "./problem.ts";

/**
 * The largest canvas, in pixels, that is read. Safari limits a canvas to 16,777,216 pixels; a photograph
 * of up to 16 megapixels is read at full resolution, a larger one is reduced.
 */
export const MAX_PIXELS = 16_000_000;

/** A canvas and its 2D context, as an OffscreenCanvas where the browser provides one. */
export function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement | OffscreenCanvas; context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (context === null) throw new Error("The browser did not provide a canvas.");
  return { canvas, context };
}

/** Releases a canvas's memory, which Safari otherwise keeps until garbage collection. */
export function release(canvas: HTMLCanvasElement | OffscreenCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

async function decodeWithElement(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A decoded image, before it is drawn. */
export interface Picture {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  close(): void;
}

/** Decodes an image file. Throws a {@link Problem} "image-unreadable". */
export async function openPicture(file: Blob, name: string): Promise<Picture> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Some browsers decode formats in an <img> element that createImageBitmap rejects.
  }
  try {
    const img = await decodeWithElement(file);
    if (img.naturalWidth === 0) throw new Error("empty image");
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } catch {
    throw new Problem("image-unreadable", { name });
  }
}

/**
 * Draws a picture at `scale` times its size, limited to {@link MAX_PIXELS}, and returns its pixels.
 * Enlargement is done without smoothing, so that modules keep sharp edges.
 */
export function pixels(picture: Picture, scale = 1): ImageData {
  const limit = Math.sqrt(MAX_PIXELS / (picture.width * picture.height));
  const s = Math.min(scale, limit);
  const width = Math.max(1, Math.round(picture.width * s));
  const height = Math.max(1, Math.round(picture.height * s));
  const { canvas, context } = canvas2d(width, height);
  try {
    context.imageSmoothingEnabled = s < 1;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(picture.source, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } finally {
    release(canvas);
  }
}
