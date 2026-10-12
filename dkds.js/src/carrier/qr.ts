/**
 * QR code encoder (ISO/IEC 18004) restricted to what specification 3.3 uses: one segment in
 * alphanumeric mode, error correction level M, versions 1 to 27. The smallest version that holds the
 * text is used; the mask is chosen by the penalty rules of ISO/IEC 18004, 7.8.3.
 */

import { fail } from "../errors.ts";
import { BASE45_ALPHABET } from "./base45.ts";

/** A QR code as a matrix of modules. */
export interface QrCode {
  /** The QR version, 1 to 27. */
  readonly version: number;
  /** The mask pattern, 0 to 7. */
  readonly mask: number;
  /** The number of modules per side, `17 + 4 * version`, without the quiet zone. */
  readonly size: number;
  /** The modules, by row and then by column; `true` is a dark module. */
  readonly modules: readonly (readonly boolean[])[];
}

/** The highest QR version a stamp uses (3.3). */
export const MAX_VERSION = 27;

/** Error correction codewords per block at level M, by version (ISO/IEC 18004, table 9). */
const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28];
/** Number of error correction blocks at level M, by version (ISO/IEC 18004, table 9). */
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25];

/** Format information bits for level M (ISO/IEC 18004, table 12). */
const LEVEL_M_BITS = 0b00;

const MODE_ALPHANUMERIC = 0b0010;
const PAD_BYTES = [0xec, 0x11];

const symbolSize = (version: number) => 17 + 4 * version;

function charCountBits(version: number): number {
  return version <= 9 ? 9 : version <= 26 ? 11 : 13;
}

/** Number of modules available for data and error correction (ISO/IEC 18004, 7.1). */
function rawDataModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

const totalCodewords = (version: number) => Math.floor(rawDataModules(version) / 8);
const dataCodewords = (version: number) => totalCodewords(version) - EC_PER_BLOCK[version]! * BLOCKS[version]!;

function dataBits(length: number, version: number): number {
  return 4 + charCountBits(version) + 11 * Math.floor(length / 2) + 6 * (length % 2);
}

/** Centre coordinates of the alignment patterns on each axis (ISO/IEC 18004, annex E). */
function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = symbolSize(version) - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}

// ---- Reed-Solomon over GF(256) with the polynomial x^8 + x^4 + x^3 + x^2 + 1 ----------------------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < degree) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i] = result[i]! ^ gfMultiply(coef, factor)));
  }
  return result;
}

// ---- Codewords ------------------------------------------------------------------------------

function encodeData(text: string, version: number): number[] {
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(MODE_ALPHANUMERIC, 4);
  append(text.length, charCountBits(version));
  for (let i = 0; i + 1 < text.length; i += 2) {
    append(BASE45_ALPHABET.indexOf(text[i]!) * 45 + BASE45_ALPHABET.indexOf(text[i + 1]!), 11);
  }
  if (text.length % 2 === 1) append(BASE45_ALPHABET.indexOf(text[text.length - 1]!), 6);

  const capacity = dataCodewords(version) * 8;
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  for (let i = 0; codewords.length < capacity / 8; i++) codewords.push(PAD_BYTES[i % 2]!);
  return codewords;
}

/** Splits data into blocks, appends error correction and interleaves (ISO/IEC 18004, 7.5 and 7.6). */
function addErrorCorrection(data: readonly number[], version: number): number[] {
  const numBlocks = BLOCKS[version]!;
  const ecLength = EC_PER_BLOCK[version]!;
  const total = totalCodewords(version);
  const numShort = numBlocks - (total % numBlocks);
  const shortLength = Math.floor(total / numBlocks);
  const divisor = rsDivisor(ecLength);

  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const length = shortLength - ecLength + (i < numShort ? 0 : 1);
    const block = data.slice(k, k + length);
    k += length;
    blocks.push([...block, ...(i < numShort ? [-1] : []), ...rsRemainder(block, divisor)]);
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    for (const block of blocks) if (block[i]! >= 0) result.push(block[i]!);
  }
  return result;
}

// ---- Matrix ---------------------------------------------------------------------------------

class Matrix {
  readonly size: number;
  readonly dark: Uint8Array;
  readonly reserved: Uint8Array;

  constructor(size: number) {
    this.size = size;
    this.dark = new Uint8Array(size * size);
    this.reserved = new Uint8Array(size * size);
  }

  get(x: number, y: number): boolean {
    return this.dark[y * this.size + x] === 1;
  }

  setFunction(x: number, y: number, dark: boolean): void {
    this.dark[y * this.size + x] = dark ? 1 : 0;
    this.reserved[y * this.size + x] = 1;
  }

  clone(): Matrix {
    const m = new Matrix(this.size);
    m.dark.set(this.dark);
    m.reserved.set(this.reserved);
    return m;
  }
}

function drawFinder(m: Matrix, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= m.size || y >= m.size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      m.setFunction(x, y, d !== 2 && d !== 4);
    }
  }
}

function drawAlignment(m: Matrix, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) m.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
}

/** BCH remainder of `value` shifted left by `bits`, for format and version information. */
function bchCode(value: number, bits: number, generator: number): number {
  let rem = value;
  for (let i = 0; i < bits; i++) rem = (rem << 1) ^ ((rem >>> (bits - 1)) * generator);
  return (value << bits) | (rem & ((1 << bits) - 1));
}

function drawFormat(m: Matrix, mask: number): void {
  const bits = bchCode((LEVEL_M_BITS << 3) | mask, 10, 0x537) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) m.setFunction(8, i, bit(i));
  m.setFunction(8, 7, bit(6));
  m.setFunction(8, 8, bit(7));
  m.setFunction(7, 8, bit(8));
  for (let i = 9; i < 15; i++) m.setFunction(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) m.setFunction(m.size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) m.setFunction(8, m.size - 15 + i, bit(i));
  m.setFunction(8, m.size - 8, true);
}

function drawVersion(m: Matrix, version: number): void {
  if (version < 7) return;
  const bits = bchCode(version, 12, 0x1f25);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = m.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    m.setFunction(a, b, dark);
    m.setFunction(b, a, dark);
  }
}

function drawFunctionPatterns(m: Matrix, version: number): void {
  for (let i = 0; i < m.size; i++) {
    m.setFunction(6, i, i % 2 === 0);
    m.setFunction(i, 6, i % 2 === 0);
  }
  drawFinder(m, 3, 3);
  drawFinder(m, m.size - 4, 3);
  drawFinder(m, 3, m.size - 4);
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((x, i) =>
    positions.forEach((y, j) => {
      const overlapsFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (!overlapsFinder) drawAlignment(m, x, y);
    }),
  );
  drawFormat(m, 0);
  drawVersion(m, version);
}

/** Places the codewords in the zigzag order of ISO/IEC 18004, 7.7.3. */
function drawCodewords(m: Matrix, codewords: readonly number[]): void {
  let i = 0;
  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < m.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? m.size - 1 - vert : vert;
        if (m.reserved[y * m.size + x] || i >= codewords.length * 8) continue;
        m.dark[y * m.size + x] = (codewords[i >>> 3]! >>> (7 - (i & 7))) & 1;
        i++;
      }
    }
  }
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m: Matrix, mask: number): void {
  const condition = MASKS[mask]!;
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.reserved[y * m.size + x] && condition(x, y)) m.dark[y * m.size + x]! ^= 1;
    }
  }
}

// ---- Penalty (ISO/IEC 18004, 7.8.3) --------------------------------------------------------------

const FINDER_LIKE = [
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
];

function linePenalty(line: readonly number[]): number {
  let penalty = 0;
  for (let i = 0; i < line.length; ) {
    let run = 1;
    while (i + run < line.length && line[i + run] === line[i]) run++;
    if (run >= 5) penalty += 3 + (run - 5);
    i += run;
  }
  const padded = [0, 0, 0, 0, ...line, 0, 0, 0, 0];
  for (let i = 0; i + 11 <= padded.length; i++) {
    for (const pattern of FINDER_LIKE) if (pattern.every((v, k) => padded[i + k] === v)) penalty += 40;
  }
  return penalty;
}

function penalty(m: Matrix): number {
  const { size } = m;
  let total = 0;
  for (let i = 0; i < size; i++) {
    const row: number[] = [];
    const column: number[] = [];
    for (let j = 0; j < size; j++) {
      row.push(m.dark[i * size + j]!);
      column.push(m.dark[j * size + i]!);
    }
    total += linePenalty(row) + linePenalty(column);
  }
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = m.dark[y * size + x];
      if (c === m.dark[y * size + x + 1] && c === m.dark[(y + 1) * size + x] && c === m.dark[(y + 1) * size + x + 1]) total += 3;
    }
  }
  let dark = 0;
  for (const v of m.dark) dark += v;
  const cells = size * size;
  total += 10 * (Math.ceil(Math.abs(dark * 20 - cells * 10) / cells) - 1);
  return total;
}

// ---- Public API -------------------------------------------------------------------------------

/** Returns the smallest version that holds a text of `length` alphanumeric characters, or `undefined`. */
export function qrVersionFor(length: number): number | undefined {
  for (let v = 1; v <= MAX_VERSION; v++) if (dataBits(length, v) <= dataCodewords(v) * 8) return v;
  return undefined;
}

/**
 * Encodes a text as a QR code in alphanumeric mode at level M. Throws `qr-invalid` when the text
 * contains a character outside the QR alphanumeric set or does not fit in version 27.
 *
 * @param mask A fixed mask pattern, 0 to 7. By default the mask with the lowest penalty is used.
 */
export function encodeQr(text: string, mask?: number): QrCode {
  for (const ch of text) {
    if (!BASE45_ALPHABET.includes(ch)) fail("qr-invalid", "The text contains a character outside the QR alphanumeric set.");
  }
  const version = qrVersionFor(text.length);
  if (version === undefined) fail("qr-invalid", `The text does not fit in a QR code of version ${MAX_VERSION} at level M (3.3).`);

  const base = new Matrix(symbolSize(version));
  drawFunctionPatterns(base, version);
  drawCodewords(base, addErrorCorrection(encodeData(text, version), version));

  const candidates = mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask];
  let best: { matrix: Matrix; mask: number; penalty: number } | undefined;
  for (const candidate of candidates) {
    if (!MASKS[candidate]) fail("invalid-argument", "The mask must be an integer from 0 to 7.");
    const m = base.clone();
    applyMask(m, candidate);
    drawFormat(m, candidate);
    const p = candidates.length > 1 ? penalty(m) : 0;
    if (best === undefined || p < best.penalty) best = { matrix: m, mask: candidate, penalty: p };
  }
  const { matrix } = best!;
  const modules = Array.from({ length: matrix.size }, (_, y) => Array.from({ length: matrix.size }, (_, x) => matrix.get(x, y)));
  return { version, mask: best!.mask, size: matrix.size, modules };
}
