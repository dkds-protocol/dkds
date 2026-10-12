/**
 * Raw DEFLATE decompression (RFC 1951) with the requirements of specification 5.2: the stream must be
 * valid, must end exactly at the end of the input, and decompression stops once the output exceeds a
 * limit.
 *
 * The validity rules are those of zlib: an over-subscribed code is invalid; an incomplete code is valid
 * only for literal/length and distance codes that consist of a single code of length 1; a literal/length
 * code must contain the end-of-block symbol; length symbols 286 and 287 and distance symbols 30 and 31
 * are invalid; a distance may not reach before the start of the output.
 */

import { fail } from "../errors.ts";
import { CODE_LENGTH_ORDER, DIST_BASE, DIST_EXTRA, LENGTH_BASE, LENGTH_EXTRA } from "./rfc1951.ts";


const MAX_BITS = 15;

/** A canonical Huffman code: the number of codes of each length, and the symbols in code order. */
interface Huffman {
  readonly count: Uint16Array;
  readonly symbol: Uint16Array;
}

/**
 * Builds a canonical Huffman code from code lengths. Returns the code and the number of unused code
 * values: 0 for a complete code, a positive number for an incomplete code, and a negative number for an
 * over-subscribed code. A code without any symbol is reported as complete.
 */
function buildHuffman(lengths: ArrayLike<number>): { code: Huffman; left: number } {
  const count = new Uint16Array(MAX_BITS + 1);
  for (let i = 0; i < lengths.length; i++) count[lengths[i]!]!++;
  const symbol = new Uint16Array(lengths.length);
  const code = { count, symbol };
  if (count[0] === lengths.length) return { code, left: 0 };

  let left = 1;
  for (let len = 1; len <= MAX_BITS; len++) {
    left = left * 2 - count[len]!;
    if (left < 0) return { code, left };
  }
  const offsets = new Uint16Array(MAX_BITS + 1);
  for (let len = 1; len < MAX_BITS; len++) offsets[len + 1] = offsets[len]! + count[len]!;
  for (let s = 0; s < lengths.length; s++) {
    const len = lengths[s]!;
    if (len !== 0) symbol[offsets[len]!++] = s;
  }
  return { code, left };
}

/** True when an incomplete code is accepted: it consists of exactly one code of length 1. */
function isSingleCode(lengths: ArrayLike<number>, code: Huffman): boolean {
  return code.count[0]! + code.count[1]! === lengths.length;
}

class Inflater {
  private readonly input: Uint8Array;
  private readonly limit: number;
  private bytePos = 0;
  private bitBuf = 0;
  private bitCount = 0;
  private output: Uint8Array;
  private outLength = 0;

  constructor(input: Uint8Array, limit: number) {
    this.input = input;
    this.limit = limit;
    this.output = new Uint8Array(Math.min(limit, Math.max(1024, input.length * 4)));
  }

  run(): Uint8Array {
    let final = 0;
    do {
      final = this.bits(1);
      const type = this.bits(2);
      if (type === 0) this.stored();
      else if (type === 1) this.codes(FIXED.lengthCode, FIXED.distCode);
      else if (type === 2) this.dynamic();
      else fail("deflate-invalid", "The DEFLATE stream contains a block of the reserved type 3 (5.2).");
    } while (!final);
    if (this.bytePos !== this.input.length) {
      fail("deflate-invalid", "Data follows the end of the DEFLATE stream (5.2).");
    }
    return this.output.slice(0, this.outLength);
  }

  private bits(n: number): number {
    let value = this.bitBuf;
    while (this.bitCount < n) {
      if (this.bytePos >= this.input.length) fail("deflate-invalid", "The DEFLATE stream is truncated (5.2).");
      value |= this.input[this.bytePos++]! << this.bitCount;
      this.bitCount += 8;
    }
    this.bitBuf = value >>> n;
    this.bitCount -= n;
    return value & ((1 << n) - 1);
  }

  private emit(byte: number): void {
    if (this.outLength >= this.limit) {
      fail("payload-too-large", `The decompressed payload exceeds ${this.limit} bytes (5.2).`);
    }
    if (this.outLength === this.output.length) {
      const grown = new Uint8Array(Math.min(this.limit, this.output.length * 2));
      grown.set(this.output);
      this.output = grown;
    }
    this.output[this.outLength++] = byte;
  }

  private stored(): void {
    this.bitBuf = 0;
    this.bitCount = 0;
    if (this.bytePos + 4 > this.input.length) fail("deflate-invalid", "The DEFLATE stream is truncated (5.2).");
    const len = this.input[this.bytePos]! | (this.input[this.bytePos + 1]! << 8);
    const nlen = this.input[this.bytePos + 2]! | (this.input[this.bytePos + 3]! << 8);
    this.bytePos += 4;
    if (len !== (~nlen & 0xffff)) fail("deflate-invalid", "A stored DEFLATE block has an inconsistent length (5.2).");
    if (this.bytePos + len > this.input.length) fail("deflate-invalid", "The DEFLATE stream is truncated (5.2).");
    for (let i = 0; i < len; i++) this.emit(this.input[this.bytePos++]!);
  }

  private decode(h: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= this.bits(1);
      const count = h.count[len]!;
      if (code - count < first) return h.symbol[index + (code - first)]!;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    return fail("deflate-invalid", "The DEFLATE stream contains an invalid Huffman code (5.2).");
  }

  private codes(lengthCode: Huffman, distCode: Huffman): void {
    for (;;) {
      let symbol = this.decode(lengthCode);
      if (symbol < 256) {
        this.emit(symbol);
        continue;
      }
      if (symbol === 256) return;
      symbol -= 257;
      if (symbol >= 29) fail("deflate-invalid", "The DEFLATE stream contains an invalid length symbol (5.2).");
      const length = LENGTH_BASE[symbol]! + this.bits(LENGTH_EXTRA[symbol]!);
      const distSymbol = this.decode(distCode);
      if (distSymbol >= 30) fail("deflate-invalid", "The DEFLATE stream contains an invalid distance symbol (5.2).");
      const distance = DIST_BASE[distSymbol]! + this.bits(DIST_EXTRA[distSymbol]!);
      if (distance > this.outLength) {
        fail("deflate-invalid", "A DEFLATE distance reaches before the start of the output (5.2).");
      }
      for (let i = 0; i < length; i++) this.emit(this.output[this.outLength - distance]!);
    }
  }

  private dynamic(): void {
    const nlen = this.bits(5) + 257;
    const ndist = this.bits(5) + 1;
    const ncode = this.bits(4) + 4;
    if (nlen > 286 || ndist > 30) fail("deflate-invalid", "A DEFLATE block declares too many codes (5.2).");

    const lengths = new Uint8Array(19);
    for (let i = 0; i < ncode; i++) lengths[CODE_LENGTH_ORDER[i]!] = this.bits(3);
    const lencode = buildHuffman(lengths);
    if (lencode.left !== 0) fail("deflate-invalid", "A DEFLATE code length code is incomplete or over-subscribed (5.2).");

    const all = new Uint8Array(nlen + ndist);
    for (let index = 0; index < nlen + ndist; ) {
      const symbol = this.decode(lencode.code);
      if (symbol < 16) {
        all[index++] = symbol;
        continue;
      }
      let value = 0;
      let repeat: number;
      if (symbol === 16) {
        if (index === 0) fail("deflate-invalid", "A DEFLATE code length repeats a missing previous length (5.2).");
        value = all[index - 1]!;
        repeat = 3 + this.bits(2);
      } else if (symbol === 17) {
        repeat = 3 + this.bits(3);
      } else {
        repeat = 11 + this.bits(7);
      }
      if (index + repeat > nlen + ndist) fail("deflate-invalid", "DEFLATE code lengths exceed the declared number (5.2).");
      all.fill(value, index, index + repeat);
      index += repeat;
    }
    if (all[256] === 0) fail("deflate-invalid", "A DEFLATE block has no end-of-block code (5.2).");

    const litLengths = all.subarray(0, nlen);
    const distLengths = all.subarray(nlen);
    const lit = buildHuffman(litLengths);
    if (lit.left < 0 || (lit.left > 0 && !isSingleCode(litLengths, lit.code))) {
      fail("deflate-invalid", "A DEFLATE literal/length code is incomplete or over-subscribed (5.2).");
    }
    const dist = buildHuffman(distLengths);
    if (dist.left < 0 || (dist.left > 0 && !isSingleCode(distLengths, dist.code))) {
      fail("deflate-invalid", "A DEFLATE distance code is incomplete or over-subscribed (5.2).");
    }
    this.codes(lit.code, dist.code);
  }
}

const FIXED = (() => {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);
  return {
    lengthCode: buildHuffman(lengths).code,
    distCode: buildHuffman(new Uint8Array(30).fill(5)).code,
  };
})();

/**
 * Decompresses a raw DEFLATE stream that occupies exactly `data`. Throws `deflate-invalid` when the
 * stream is invalid, truncated or followed by other data, and `payload-too-large` as soon as the output
 * would exceed `limit` bytes.
 */
export function inflateRaw(data: Uint8Array, limit: number): Uint8Array {
  return new Inflater(data, limit).run();
}
