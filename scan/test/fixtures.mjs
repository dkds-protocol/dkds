// Test material: stamps signed with a test key, QR images, a camera stream and PDF files.
//
// Images are drawn from the module matrix of dkds.js: scaled, rotated, distorted in perspective,
// blurred, unevenly lit and given noise, to approximate photographs of printed stamps.

import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createStamp, encodeQr, keyRecord, publicKeyOf } from "../../dkds.js/src/index.ts";
import { qrVersionFor } from "../../dkds.js/src/carrier/qr.ts";
import { encodePng } from "../../brand/lib/png.mjs";

/** The seeds of the test keys, and their key records. */
export const KEY_A = new Uint8Array(32).fill(7);
export const KEY_B = new Uint8Array(32).fill(9);
export const RECORD_A = keyRecord(publicKeyOf(KEY_A));
export const RECORD_B = keyRecord(publicKeyOf(KEY_B));
export const DOMAIN = "scan-test.example";
export const KEY_ID = "t1";
export const ISSUED = 1790758800;

/** A deterministic generator of alphanumeric text, which DEFLATE cannot shorten much. */
function noise(length, seed) {
  let x = seed >>> 0 || 1;
  let s = "";
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    s += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[(x >>> 0) % 62];
  }
  return s;
}

/** Signs a stamp with a test key. */
export function stamp({ domain = DOMAIN, keyId = KEY_ID, fields, key = KEY_A, issuedAt = ISSUED }) {
  return createStamp({ domain, keyId, fields, privateKey: key, issuedAt });
}

/** The DNS of the test stamps, in the form of the test vectors. */
export function testDns(record = RECORD_A, domain = DOMAIN) {
  return { [`${KEY_ID}._dkds.${domain}`]: { result: "answer", txt: [[record]], dnssec: true } };
}

/** One valid stamp per QR version from the smallest a stamp can have to 27. */
export async function stampsByVersion() {
  const byVersion = new Map();
  for (let length = 0; length <= 1600 && !byVersion.has(27); length += 3) {
    const fields = [["Reference", "2026-0917"], ["Data", noise(length, length + 1)]];
    const s = await stamp({ fields }).catch(() => undefined);
    if (s === undefined) break;
    const v = qrVersionFor(s.text.length);
    if (v !== undefined && !byVersion.has(v)) byVersion.set(v, { stamp: s, fields });
  }
  return byVersion;
}

/** A QR code of each version below the smallest stamp: text with the prefix, which is not a valid stamp. */
export function shortCodes(below) {
  const codes = [];
  for (let v = 1; v < below; v++) {
    let text = "DKDS:";
    while (qrVersionFor(text.length + 1) <= v) text += "A";
    codes.push({ version: v, text });
  }
  return codes;
}

// ---- images ---------------------------------------------------------------------

/**
 * Draws QR codes onto a grey image and returns its luminance, row by row.
 *
 * @param codes [{ qr, x, y, scale, angle }]: the centre of each code, its module size in pixels and
 *   its rotation in degrees.
 * @param options blur radius, noise amplitude, light gradient and perspective strength.
 */
export function drawCodes(width, height, codes, { blur = 0, noiseLevel = 0, gradient = 0, perspective = 0, background = 255 } = {}) {
  const lum = new Float32Array(width * height).fill(background);
  for (const { qr, x: cx, y: cy, scale, angle = 0 } of codes) {
    const n = qr.size;
    const cos = Math.cos((angle * Math.PI) / 180);
    const sin = Math.sin((angle * Math.PI) / 180);
    const half = ((n + 8) * scale) / 2;
    const reach = Math.ceil(half * 1.5);
    for (let py = Math.max(0, Math.floor(cy - reach)); py < Math.min(height, cy + reach); py++) {
      for (let px = Math.max(0, Math.floor(cx - reach)); px < Math.min(width, cx + reach); px++) {
        let dx = px + 0.5 - cx;
        let dy = py + 0.5 - cy;
        // A simple keystone: rows further down are wider.
        const k = 1 + (perspective * dy) / half;
        dx /= k;
        const u = (cos * dx + sin * dy) / scale + (n + 8) / 2 - 4;
        const v = (-sin * dx + cos * dy) / scale + (n + 8) / 2 - 4;
        if (u < -4 || v < -4 || u >= n + 4 || v >= n + 4) continue;
        const dark = u >= 0 && v >= 0 && u < n && v < n && qr.modules[Math.floor(v)][Math.floor(u)];
        lum[py * width + px] = dark ? 25 : 245;
      }
    }
  }
  let out = lum;
  if (blur > 0) out = boxBlur(boxBlur(out, width, height, blur), width, height, blur);
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) - 0.5;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const light = 1 - gradient * (x / width) * 0.6;
      out[i] = Math.max(0, Math.min(255, out[i] * light + noiseLevel * random()));
    }
  }
  return out;
}

function boxBlur(src, width, height, r) {
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let c = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < width) (s += src[y * width + xx]), c++;
      }
      tmp[y * width + x] = s / c;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let c = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < height) (s += tmp[yy * width + x]), c++;
      }
      dst[y * width + x] = s / c;
    }
  }
  return dst;
}

/** Encodes luminance as a PNG file. */
export function lumPng(width, height, lum) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < lum.length; i++) {
    const v = Math.round(lum[i]);
    rgba.set([v, v, v, 255], i * 4);
  }
  return encodePng(width, height, rgba);
}

/** A PNG of one QR code with a quiet zone, `scale` pixels per module. */
export function qrPng(qr, scale, options = {}) {
  const side = Math.ceil((qr.size + 8) * scale * (options.angle ? 1.5 : 1)) + 2 * (options.margin ?? 0);
  return lumPng(side, side, drawCodes(side, side, [{ qr, x: side / 2, y: side / 2, scale, angle: options.angle ?? 0 }], options));
}

// ---- camera stream ------------------------------------------------------------------

/** A Y4M video of `frames` frames showing a QR code, for Chrome's fake camera. */
export function y4m(qr, { width = 1280, height = 720, frames = 10, scale = 5, angle = 7 } = {}) {
  const lum = drawCodes(width, height, [{ qr, x: width / 2 + 40, y: height / 2, scale, angle }], { blur: 1, noiseLevel: 18, gradient: 0.3, perspective: 0.06, background: 200 });
  const y = Uint8Array.from(lum, (v) => Math.round(v));
  const chroma = new Uint8Array((width / 2) * (height / 2)).fill(128);
  const parts = [Buffer.from(`YUV4MPEG2 W${width} H${height} F15:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < frames; i++) parts.push(Buffer.from("FRAME\n"), y, chroma, chroma);
  return Buffer.concat(parts);
}

// ---- PDF files ------------------------------------------------------------------------

/** Content stream operators drawing a QR code as filled rectangles, `size` points wide, at (x, y). */
export function qrVector(qr, x, y, size) {
  const m = size / qr.size;
  let ops = "0 0 0 rg\n";
  qr.modules.forEach((row, r) => {
    for (let c = 0; c < row.length; ) {
      if (!row[c]) {
        c++;
        continue;
      }
      let run = 1;
      while (row[c + run]) run++;
      ops += `${(x + c * m).toFixed(3)} ${(y + size - (r + 1) * m).toFixed(3)} ${(run * m).toFixed(3)} ${m.toFixed(3)} re\n`;
      c += run;
    }
  });
  return ops + "f\n";
}

/** A greyscale image XObject of a QR code, one pixel per module and a quiet zone of four modules. */
export function qrImage(qr) {
  const side = qr.size + 8;
  const pixels = new Uint8Array(side * side).fill(255);
  qr.modules.forEach((row, r) => row.forEach((dark, c) => dark && (pixels[(r + 4) * side + c + 4] = 0)));
  return { width: side, height: side, data: deflateSync(pixels) };
}

/**
 * Writes a PDF file. Each page is { content, images: { name: image } }. With `password`, the file is
 * encrypted with the standard security handler, revision 3, 128-bit RC4 (ISO 32000-1, 7.6.3).
 */
export function pdf(pages, { password } = {}) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  const streams = [];
  for (const page of pages) {
    const xobjects = [];
    for (const [name, image] of Object.entries(page.images ?? {})) {
      const id = add(null);
      streams.push({ id, dict: `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, data: image.data });
      xobjects.push(`/${name} ${id} 0 R`);
    }
    const content = add(null);
    streams.push({ id: content, dict: "", data: Buffer.from(page.content ?? "") });
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> /XObject << ${xobjects.join(" ")} >> >> >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  const fileId = createHash("md5").update("dkds-scan-test").digest();
  let encrypt;
  let objectKey = () => null;
  if (password !== undefined) {
    const { key, entries } = standardSecurity(password, fileId);
    encrypt = add(entries);
    objectKey = (id) => createHash("md5").update(Buffer.concat([key, Buffer.from([id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff, 0, 0])])).digest();
  }
  for (const s of streams) {
    const k = objectKey(s.id);
    const data = k ? rc4(k, s.data) : s.data;
    objects[s.id - 1] = { dict: `<< ${s.dict} /Length ${data.length} >>`, data };
  }

  const parts = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let length = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk =
      typeof body === "string"
        ? Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, "latin1")
        : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${body.dict}\nstream\n`, "latin1"), body.data, Buffer.from("\nendstream\nendobj\n")]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  const id = fileId.toString("hex");
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${encrypt ? ` /Encrypt ${encrypt} 0 R` : ""} /ID [<${id}> <${id}>] >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref + trailer, "latin1"));
  return Buffer.concat(parts);
}

/** RC4, which OpenSSL 3 provides only in its legacy provider. */
function rc4(key, data) {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

const PAD = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");

/** The encryption key and Encrypt dictionary of the standard security handler, revision 3 (algorithms 2, 3 and 5). */
function standardSecurity(password, fileId) {
  const padded = Buffer.concat([Buffer.from(password, "latin1"), PAD]).subarray(0, 32);
  const permissions = -4;
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions);
  // Owner value (algorithm 3), with the owner password equal to the user password.
  let ownerKey = createHash("md5").update(padded).digest();
  for (let i = 0; i < 50; i++) ownerKey = createHash("md5").update(ownerKey).digest();
  let o = rc4(ownerKey, padded);
  for (let i = 1; i <= 19; i++) o = rc4(Buffer.from(ownerKey.map((b) => b ^ i)), o);
  // Encryption key (algorithm 2).
  let key = createHash("md5").update(Buffer.concat([padded, o, p, fileId])).digest();
  for (let i = 0; i < 50; i++) key = createHash("md5").update(key).digest();
  // User value (algorithm 5).
  let u = rc4(key, createHash("md5").update(Buffer.concat([PAD, fileId])).digest());
  for (let i = 1; i <= 19; i++) u = rc4(Buffer.from(key.map((b) => b ^ i)), u);
  u = Buffer.concat([u, Buffer.alloc(16)]);
  return { key, entries: `<< /Filter /Standard /V 2 /R 3 /Length 128 /O <${o.toString("hex")}> /U <${u.toString("hex")}> /P ${permissions} >>` };
}

export { encodeQr };
