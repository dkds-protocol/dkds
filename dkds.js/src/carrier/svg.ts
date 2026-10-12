/**
 * Rendering of a QR code as SVG.
 */

import { fail } from "../errors.ts";
import type { QrCode } from "./qr.ts";

/** Options of {@link renderSvg}. */
export interface SvgOptions {
  /** The size of one module, in millimetres. Default: 0.33 (specification, section 10, item 6). */
  readonly moduleSize?: number;
  /** The width of the quiet zone, in modules. Default: 4. */
  readonly quietZone?: number;
}

/**
 * Renders a QR code as a standalone SVG document, black on white, with its physical size in
 * millimetres. Dark modules are drawn as one path of horizontal runs.
 */
export function renderSvg(qr: QrCode, options: SvgOptions = {}): string {
  const moduleSize = options.moduleSize ?? 0.33;
  const quiet = options.quietZone ?? 4;
  if (!(moduleSize > 0) || !Number.isFinite(moduleSize)) fail("invalid-argument", "moduleSize must be a positive number.");
  if (!Number.isInteger(quiet) || quiet < 0) fail("invalid-argument", "quietZone must be a non-negative integer.");

  const total = qr.size + 2 * quiet;
  const mm = +(total * moduleSize).toFixed(3);
  let path = "";
  qr.modules.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let run = 1;
      while (row[x + run]) run++;
      path += `M${x + quiet} ${y + quiet}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mm}mm" height="${mm}mm" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
  );
}
