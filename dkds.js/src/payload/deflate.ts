/**
 * Raw DEFLATE compression (RFC 1951) for inputs of at most 65,535 bytes, which covers every payload
 * (specification 5.2 limits it to 16,384 bytes).
 *
 * The output is a single final block of whichever type is smallest: stored, fixed Huffman or dynamic
 * Huffman. Matches are found with hash chains and one step of lazy evaluation; code lengths are optimal
 * under the length limit (package-merge). The output depends only on the input, so it is identical in
 * every runtime.
 */

import { fail } from "../errors.ts";
import { CODE_LENGTH_ORDER, DIST_BASE, DIST_EXTRA, LENGTH_BASE, LENGTH_EXTRA } from "./rfc1951.ts";

const MAX_INPUT = 65535;
const WINDOW = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MAX_CHAIN = 4096;
const HASH_BITS = 15;


/** A literal byte, or a back-reference of `length` bytes at `distance`. */
type Token = { literal: number } | { length: number; distance: number };

// ---- Symbols --------------------------------------------------------------------------------

function lengthSymbol(length: number): number {
  let i = LENGTH_BASE.length - 1;
  while (LENGTH_BASE[i]! > length) i--;
  return i;
}

function distSymbol(distance: number): number {
  let i = DIST_BASE.length - 1;
  while (DIST_BASE[i]! > distance) i--;
  return i;
}

// ---- Matching -------------------------------------------------------------------------------

/** Splits the input into literals and back-references. */
function tokenize(data: Uint8Array): Token[] {
  const n = data.length;
  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const hash = (i: number) => ((data[i]! << 10) ^ (data[i + 1]! << 5) ^ data[i + 2]!) & ((1 << HASH_BITS) - 1);
  let inserted = 0;
  const insertUpTo = (end: number) => {
    for (; inserted < Math.min(end, n - MIN_MATCH + 1); inserted++) {
      const h = hash(inserted);
      prev[inserted] = head[h]!;
      head[h] = inserted;
    }
  };
  const longestMatch = (i: number): { length: number; distance: number } => {
    let best = { length: 0, distance: 0 };
    if (i + MIN_MATCH > n) return best;
    const max = Math.min(MAX_MATCH, n - i);
    let chain = MAX_CHAIN;
    for (let j = prev[i]!; j >= 0 && i - j <= WINDOW && chain-- > 0; j = prev[j]!) {
      if (data[j + best.length] !== data[i + best.length]) continue;
      let len = 0;
      while (len < max && data[j + len] === data[i + len]) len++;
      if (len > best.length) {
        best = { length: len, distance: i - j };
        if (len === max) break;
      }
    }
    return best.length >= MIN_MATCH ? best : { length: 0, distance: 0 };
  };

  const tokens: Token[] = [];
  let i = 0;
  insertUpTo(1);
  let match = longestMatch(0);
  while (i < n) {
    if (match.length === 0) {
      tokens.push({ literal: data[i]! });
      i++;
      insertUpTo(i + 1);
      match = longestMatch(i);
      continue;
    }
    insertUpTo(i + 2);
    const next = longestMatch(i + 1);
    if (next.length > match.length) {
      tokens.push({ literal: data[i]! });
      i++;
      match = next;
      continue;
    }
    tokens.push(match);
    i += match.length;
    insertUpTo(i + 1);
    match = longestMatch(i);
  }
  return tokens;
}

// ---- Huffman codes --------------------------------------------------------------------------

/**
 * Returns optimal code lengths of at most `maxBits` bits for the given frequencies (package-merge).
 * Symbols with frequency 0 get length 0. At least two symbols must have a non-zero frequency.
 */
function codeLengths(freqs: readonly number[], maxBits: number): number[] {
  type Item = { weight: number; symbols: number[] };
  const leaves: Item[] = [];
  for (let s = 0; s < freqs.length; s++) if (freqs[s]! > 0) leaves.push({ weight: freqs[s]!, symbols: [s] });
  leaves.sort((a, b) => a.weight - b.weight || a.symbols[0]! - b.symbols[0]!);

  let list = leaves;
  for (let level = 1; level < maxBits; level++) {
    const packages: Item[] = [];
    for (let i = 0; i + 1 < list.length; i += 2) {
      packages.push({ weight: list[i]!.weight + list[i + 1]!.weight, symbols: [...list[i]!.symbols, ...list[i + 1]!.symbols] });
    }
    const merged: Item[] = [];
    let a = 0;
    let b = 0;
    while (a < leaves.length || b < packages.length) {
      if (b >= packages.length || (a < leaves.length && leaves[a]!.weight <= packages[b]!.weight)) merged.push(leaves[a++]!);
      else merged.push(packages[b++]!);
    }
    list = merged;
  }

  const lengths = new Array<number>(freqs.length).fill(0);
  for (const item of list.slice(0, 2 * leaves.length - 2)) for (const s of item.symbols) lengths[s]!++;
  return lengths;
}

/** Ensures that at least two symbols have a non-zero frequency, so that every code is complete. */
function withTwoSymbols(freqs: number[]): number[] {
  const out = [...freqs];
  for (let s = 0; out.filter((f) => f > 0).length < 2; s++) if (out[s] === 0) out[s] = 1;
  return out;
}

/** Assigns canonical codes to code lengths (RFC 1951, 3.2.2). */
function canonicalCodes(lengths: readonly number[]): number[] {
  const count = new Array<number>(16).fill(0);
  for (const len of lengths) if (len) count[len]!++;
  const next = new Array<number>(16).fill(0);
  for (let len = 1, code = 0; len < 16; len++) {
    code = (code + count[len - 1]!) << 1;
    next[len] = code;
  }
  return lengths.map((len) => (len ? next[len]!++ : 0));
}

interface Code {
  readonly lengths: readonly number[];
  readonly codes: readonly number[];
}

function makeCode(lengths: readonly number[]): Code {
  return { lengths, codes: canonicalCodes(lengths) };
}

const FIXED_LIT = makeCode(Array.from({ length: 288 }, (_, s) => (s < 144 ? 8 : s < 256 ? 9 : s < 280 ? 7 : 8)));
const FIXED_DIST = makeCode(new Array<number>(30).fill(5));

// ---- Output ---------------------------------------------------------------------------------

class BitWriter {
  private readonly bytes: number[] = [];
  private acc = 0;
  private count = 0;

  /** Writes `n` bits of `value`, least significant bit first. */
  bits(value: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.acc |= ((value >> i) & 1) << this.count;
      if (++this.count === 8) this.flushByte();
    }
  }

  /** Writes a Huffman code, most significant bit first (RFC 1951, 3.1.1). */
  code(code: Code, symbol: number): void {
    const len = code.lengths[symbol]!;
    const value = code.codes[symbol]!;
    for (let i = len - 1; i >= 0; i--) this.bits((value >> i) & 1, 1);
  }

  /** Pads to a byte boundary with zero bits. */
  align(): void {
    if (this.count > 0) this.flushByte();
  }

  byte(value: number): void {
    this.bytes.push(value);
  }

  finish(): Uint8Array {
    this.align();
    return Uint8Array.from(this.bytes);
  }

  private flushByte(): void {
    this.bytes.push(this.acc);
    this.acc = 0;
    this.count = 0;
  }
}

function writeTokens(out: BitWriter, tokens: readonly Token[], lit: Code, dist: Code): void {
  for (const t of tokens) {
    if ("literal" in t) {
      out.code(lit, t.literal);
      continue;
    }
    const ls = lengthSymbol(t.length);
    out.code(lit, 257 + ls);
    out.bits(t.length - LENGTH_BASE[ls]!, LENGTH_EXTRA[ls]!);
    const ds = distSymbol(t.distance);
    out.code(dist, ds);
    out.bits(t.distance - DIST_BASE[ds]!, DIST_EXTRA[ds]!);
  }
  out.code(lit, 256);
}

function tokenBits(tokens: readonly Token[], lit: Code, dist: Code): number {
  let bits = lit.lengths[256]!;
  for (const t of tokens) {
    if ("literal" in t) {
      bits += lit.lengths[t.literal]!;
    } else {
      const ls = lengthSymbol(t.length);
      const ds = distSymbol(t.distance);
      bits += lit.lengths[257 + ls]! + LENGTH_EXTRA[ls]! + dist.lengths[ds]! + DIST_EXTRA[ds]!;
    }
  }
  return bits;
}

/** The code-length sequence of a dynamic block header, run-length encoded (RFC 1951, 3.2.7). */
type LengthOp = { symbol: number; extra: number; extraBits: number };

function runLengths(lengths: readonly number[]): LengthOp[] {
  const ops: LengthOp[] = [];
  for (let i = 0; i < lengths.length; ) {
    const value = lengths[i]!;
    let run = 1;
    while (i + run < lengths.length && lengths[i + run] === value) run++;
    i += run;
    if (value === 0) {
      while (run >= 11) {
        const r = Math.min(run, 138);
        ops.push({ symbol: 18, extra: r - 11, extraBits: 7 });
        run -= r;
      }
      if (run >= 3) {
        ops.push({ symbol: 17, extra: run - 3, extraBits: 3 });
        run = 0;
      }
    } else {
      ops.push({ symbol: value, extra: 0, extraBits: 0 });
      run--;
      while (run >= 3) {
        const r = Math.min(run, 6);
        ops.push({ symbol: 16, extra: r - 3, extraBits: 2 });
        run -= r;
      }
    }
    for (; run > 0; run--) ops.push({ symbol: value, extra: 0, extraBits: 0 });
  }
  return ops;
}

interface DynamicHeader {
  readonly lit: Code;
  readonly dist: Code;
  readonly nlen: number;
  readonly ndist: number;
  readonly lengthCode: Code;
  readonly ncode: number;
  readonly ops: readonly LengthOp[];
  readonly bits: number;
}

function dynamicHeader(tokens: readonly Token[]): DynamicHeader {
  const litFreq = new Array<number>(286).fill(0);
  const distFreq = new Array<number>(30).fill(0);
  litFreq[256] = 1;
  for (const t of tokens) {
    if ("literal" in t) {
      litFreq[t.literal]!++;
    } else {
      litFreq[257 + lengthSymbol(t.length)]!++;
      distFreq[distSymbol(t.distance)]!++;
    }
  }
  const lit = makeCode(codeLengths(withTwoSymbols(litFreq), 15));
  const dist = makeCode(codeLengths(withTwoSymbols(distFreq), 15));
  let nlen = 286;
  while (nlen > 257 && lit.lengths[nlen - 1] === 0) nlen--;
  let ndist = 30;
  while (ndist > 1 && dist.lengths[ndist - 1] === 0) ndist--;

  const ops = runLengths([...lit.lengths.slice(0, nlen), ...dist.lengths.slice(0, ndist)]);
  const opFreq = new Array<number>(19).fill(0);
  for (const op of ops) opFreq[op.symbol]!++;
  const lengthCode = makeCode(codeLengths(withTwoSymbols(opFreq), 7));
  let ncode = 19;
  while (ncode > 4 && lengthCode.lengths[CODE_LENGTH_ORDER[ncode - 1]!] === 0) ncode--;

  let bits = 5 + 5 + 4 + 3 * ncode;
  for (const op of ops) bits += lengthCode.lengths[op.symbol]! + op.extraBits;
  return { lit, dist, nlen, ndist, lengthCode, ncode, ops, bits };
}

/**
 * Compresses `data` as one raw DEFLATE stream. Throws `invalid-argument` for inputs longer than 65,535
 * bytes.
 */
export function deflateRaw(data: Uint8Array): Uint8Array {
  if (data.length > MAX_INPUT) fail("invalid-argument", `deflateRaw accepts at most ${MAX_INPUT} bytes.`);
  const tokens = tokenize(data);
  const header = dynamicHeader(tokens);

  const storedBits = 3 + 7 + 32 + 8 * data.length;
  const fixedBits = 3 + tokenBits(tokens, FIXED_LIT, FIXED_DIST);
  const dynamicBits = 3 + header.bits + tokenBits(tokens, header.lit, header.dist);

  const out = new BitWriter();
  if (storedBits <= fixedBits && storedBits <= dynamicBits) {
    out.bits(1, 1);
    out.bits(0, 2);
    out.align();
    for (const b of [data.length & 0xff, data.length >> 8, ~data.length & 0xff, (~data.length >> 8) & 0xff]) out.byte(b);
    for (const b of data) out.byte(b);
  } else if (fixedBits <= dynamicBits) {
    out.bits(1, 1);
    out.bits(1, 2);
    writeTokens(out, tokens, FIXED_LIT, FIXED_DIST);
  } else {
    out.bits(1, 1);
    out.bits(2, 2);
    out.bits(header.nlen - 257, 5);
    out.bits(header.ndist - 1, 5);
    out.bits(header.ncode - 4, 4);
    for (let i = 0; i < header.ncode; i++) out.bits(header.lengthCode.lengths[CODE_LENGTH_ORDER[i]!]!, 3);
    for (const op of header.ops) {
      out.code(header.lengthCode, op.symbol);
      out.bits(op.extra, op.extraBits);
    }
    writeTokens(out, tokens, header.lit, header.dist);
  }
  return out.finish();
}
