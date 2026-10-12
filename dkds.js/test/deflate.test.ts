/**
 * DEFLATE: the compressor's output is decompressed by zlib, and the decompressor accepts and rejects
 * exactly the streams that zlib accepts and rejects, on valid, corrupted, truncated and extended input.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { constants, deflateRawSync, inflateRawSync } from "node:zlib";
import { DkdsError } from "../src/errors.ts";
import { deflateRaw } from "../src/payload/deflate.ts";
import { inflateRaw } from "../src/payload/inflate.ts";

const LIMIT = 16384;

function random(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

/** Inputs of varying size and redundancy. */
function samples(rnd: () => number): Uint8Array[] {
  const out: Uint8Array[] = [new Uint8Array(0), new Uint8Array(1), new Uint8Array(LIMIT), new TextEncoder().encode("Invoice no.2026-0917".repeat(40))];
  for (let i = 0; i < 120; i++) {
    const length = Math.floor(rnd() ** 2 * 6000);
    const alphabet = 1 + Math.floor(rnd() ** 3 * 255);
    out.push(Uint8Array.from({ length }, () => Math.floor(rnd() * alphabet)));
  }
  return out;
}

/** zlib's decision with the rules of specification 5.2, in the form used by the reference verifier. */
function zlibInflate(data: Uint8Array): Uint8Array | null {
  try {
    const r = inflateRawSync(data, { maxOutputLength: LIMIT + 1, finishFlush: constants.Z_FINISH, info: true }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    if (r.engine.bytesWritten !== data.length || r.buffer.length > LIMIT) return null;
    return new Uint8Array(r.buffer);
  } catch {
    return null;
  }
}

function ownInflate(data: Uint8Array): Uint8Array | null {
  try {
    return inflateRaw(data, LIMIT);
  } catch (e) {
    if (e instanceof DkdsError) return null;
    throw e;
  }
}

test("compressed output is decompressed to the input by zlib and by inflateRaw", () => {
  for (const input of samples(random(1))) {
    const compressed = deflateRaw(input);
    assert.deepEqual(new Uint8Array(inflateRawSync(compressed)), input);
    assert.deepEqual(inflateRaw(compressed, 65535), input);
  }
});

test("on the field lists of the test vectors, the compressor is within 1% of zlib level 9", () => {
  const file = JSON.parse(readFileSync(new URL("../../spec/vectors/vectors.json", import.meta.url), "utf8"));
  let ours = 0;
  let zlib = 0;
  for (const v of file.vectors) {
    if (!v.intermediate) continue;
    const fieldList = Buffer.from(v.intermediate.field_list, "hex");
    ours += deflateRaw(fieldList).length;
    zlib += deflateRawSync(fieldList, { level: 9 }).length;
  }
  assert.ok(ours <= zlib * 1.01, `${ours} bytes against ${zlib}`);
});

test("inflateRaw agrees with zlib on valid, corrupted, truncated and extended streams", () => {
  const rnd = random(3);
  const streams: Uint8Array[] = [];
  for (const input of samples(rnd).filter((s) => s.length <= LIMIT)) {
    streams.push(deflateRaw(input));
    for (const options of [{ level: 0 }, { level: 1 }, { level: 9 }, { strategy: constants.Z_FIXED }, { strategy: constants.Z_HUFFMAN_ONLY }]) {
      streams.push(new Uint8Array(deflateRawSync(input, options)));
    }
  }
  let cases = 0;
  for (const stream of streams) {
    const variants: Uint8Array[] = [stream, stream.subarray(0, stream.length - 1), Uint8Array.from([...stream, 0])];
    for (let i = 0; i < 12 && stream.length > 0; i++) {
      const v = stream.slice();
      for (let flips = 1 + Math.floor(rnd() * 3); flips > 0; flips--) v[Math.floor(rnd() * v.length)]! ^= 1 << Math.floor(rnd() * 8);
      variants.push(v);
    }
    for (const v of variants) {
      const expected = zlibInflate(v);
      const actual = ownInflate(v);
      assert.deepEqual(actual, expected, `stream ${Buffer.from(v).toString("hex").slice(0, 64)}...`);
      cases++;
    }
  }
  assert.ok(cases > 5000);
});

test("inflateRaw stops at the limit", () => {
  const bomb = deflateRawSync(new Uint8Array(10_000_000));
  assert.throws(() => inflateRaw(new Uint8Array(bomb), LIMIT), (e: unknown) => e instanceof DkdsError && e.code === "payload-too-large");
  assert.equal(inflateRaw(new Uint8Array(deflateRawSync(new Uint8Array(LIMIT))), LIMIT).length, LIMIT);
});
