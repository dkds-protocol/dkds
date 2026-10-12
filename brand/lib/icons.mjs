// The mark and the icons for the builds of dkds.org and scan.dkds.org: symbols to place with <use>,
// the favicons and the application icons, all drawn from mark.svg and icons.svg.

import { readFileSync } from "node:fs";
import { encodePng } from "./png.mjs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const stripComments = (svg) => svg.replace(/\s*<!--[\s\S]*?-->/g, "");

export const PAPER = "#F5F6F4";
export const INK = "#101418";

/** The mark of mark.svg as `<symbol id="i-mark">`, in `currentColor`. */
export function markSymbol() {
  return stripComments(read("mark.svg"))
    .replace(/<svg[^>]*viewBox="([^"]+)"[^>]*>/, '<symbol id="i-mark" viewBox="$1" fill="currentColor">')
    .replace("</svg>", "</symbol>")
    .trim();
}

/** The symbols of icons.svg. */
export function iconSymbols() {
  return stripComments(read("icons.svg"))
    .replace(/^\s*<svg[^>]*>\s*/, "")
    .replace(/\s*<\/svg>\s*$/, "")
    .trim();
}

// ---- rasterising the mark ---------------------------------------------------------

/**
 * The paths of mark.svg as polygons. The mark is drawn with the absolute commands M, H, V, L and Z
 * only; any other command is an error.
 */
function markPolygons() {
  const svg = read("mark.svg");
  const [, , width] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const paths = [...svg.matchAll(/<path ([^>]*)\/>/g)].map(([, attrs]) => {
    const evenOdd = /fill-rule="evenodd"/.test(attrs);
    const d = attrs.match(/\bd="([^"]+)"/)[1];
    const rings = [];
    let ring;
    let x = 0;
    let y = 0;
    for (const [, command, args] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
      const n = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
      if (command === "M") rings.push((ring = [[(x = n[0]), (y = n[1])]]));
      else if (command === "H") ring.push([(x = n[0]), y]);
      else if (command === "V") ring.push([x, (y = n[0])]);
      else if (command === "L") ring.push([(x = n[0]), (y = n[1])]);
      else if (command === "Z") continue;
      else throw new Error(`mark.svg: the path command ${command} is not supported`);
    }
    return { evenOdd, rings };
  });
  return { width, paths };
}

/** Whether a point is inside a path: the winding number, or its parity for the even-odd rule. */
function inside(path, px, py) {
  let winding = 0;
  for (const ring of path.rings) {
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      if (y1 <= py && y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) winding++;
      else if (y1 > py && y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) winding--;
    }
  }
  return path.evenOdd ? winding % 2 !== 0 : winding !== 0;
}

const rgba = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255);

/**
 * A PNG of the mark, `size` pixels square. The mark is drawn at the largest multiple of its 16 cells
 * that fits within `fraction` of the size, so that every cell covers whole pixels; the background is
 * paper, or transparent when `background` is null.
 */
export function markPng(size, fraction, background = PAPER) {
  const { width, paths } = markPolygons();
  const mark = Math.max(16, Math.floor((size * fraction) / 16) * 16);
  const offset = Math.round((size - mark) / 2);
  const ink = rgba(INK);
  const paper = background ? rgba(background) : [0, 0, 0, 0];
  const pixels = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const u = ((px - offset + (sx + 0.5) / 4) / mark) * width;
          const v = ((py - offset + (sy + 0.5) / 4) / mark) * width;
          if (paths.some((p) => inside(p, u, v))) hits++;
        }
      }
      const a = hits / 16;
      const at = (py * size + px) * 4;
      if (background) for (let c = 0; c < 4; c++) pixels[at + c] = Math.round(paper[c] * (1 - a) + ink[c] * a);
      else pixels.set([ink[0], ink[1], ink[2], Math.round(255 * a)], at);
    }
  }
  return encodePng(size, size, pixels);
}

/** The favicon as SVG: ink on light browser chrome, paper on dark. */
export function faviconSvg() {
  return stripComments(read("mark.svg")).replace(
    /(<svg[^>]*>)/,
    `$1<style>svg{color:${INK}}@media (prefers-color-scheme:dark){svg{color:${PAPER}}}</style>`,
  );
}

/**
 * An ICO file holding one PNG image, which browsers request as /favicon.ico for pages that name no
 * icon, such as plain text files.
 */
export function icoFile(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // number of images
  header.writeUInt8(size, 6);
  header.writeUInt8(size, 7);
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // offset of the image
  return Buffer.concat([header, png]);
}

/**
 * The icon files of a site, by file name: the SVG favicon, a 32-pixel PNG favicon and the same image
 * as favicon.ico, the Apple touch icon, and the icons of a web application manifest.
 */
export function iconFiles() {
  const favicon = markPng(32, 1, null);
  return {
    "favicon.svg": faviconSvg(),
    "favicon-32.png": favicon,
    "favicon.ico": icoFile(Buffer.from(favicon), 32),
    "apple-touch-icon.png": markPng(180, 0.8),
    "icon-192.png": markPng(192, 0.75),
    "icon-512.png": markPng(512, 0.75),
    "icon-maskable-512.png": markPng(512, 0.5),
  };
}

/** The link elements for the favicons, with paths relative to the site root. */
export const ICON_LINKS = [
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
  '<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
].join("\n");
