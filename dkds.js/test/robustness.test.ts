/**
 * Round trips, mutations and differential testing against the reference verifier of the specification
 * (`spec/tools/verify.mjs`).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { base45Encode } from "../src/carrier/base45.ts";
import { decodeText } from "../src/carrier/text.ts";
import { createStamp, keyRecord, OUTCOMES, publicKeyOf, verifyStamp, type Resolver } from "../src/index.ts";
// @ts-expect-error The reference verifier is JavaScript without type declarations.
import { verifyStamp as referenceVerify } from "../../spec/tools/verify.mjs";

const seed = new Uint8Array(32).fill(0x07);
const NOW = 1790758800;

function random(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

/** Code points from several scripts, joiners and characters next to the forbidden ranges. */
const ALPHABET = [..."abcXYZ019 .,-€", ..."Ωπλ", ..."Жщю", ..."أبت", ..."שלום", ..."日本語", ..."ひら", ..."한글", ..."देव", "‌", "‍", " ", " ", "~", " ", "\u{1f600}", "\u{1fffd}", "\u{10fffd}"];

function randomText(rnd: () => number, maxLength: number): string {
  let s = "";
  const length = Math.floor(rnd() * (maxLength + 1));
  for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
  return s.normalize("NFC");
}

function randomFields(rnd: () => number): [string, string][] {
  const count = 1 + Math.floor(rnd() ** 2 * 30);
  const fields: [string, string][] = [];
  const names = new Set<string>();
  while (fields.length < count) {
    const name = randomText(rnd, 20) || "n";
    if (names.has(name)) continue;
    names.add(name);
    fields.push([name, randomText(rnd, 40)]);
  }
  return fields;
}

const zone = (domain: string, keyId = "k1") => ({ [`${keyId}._dkds.${domain}`]: [[keyRecord(publicKeyOf(seed))]] });

function resolverFor(records: Record<string, string[][]>): Resolver {
  return async (name) => (records[name] ? { result: "answer", txt: records[name]!, dnssec: false } : { result: "nxdomain" });
}

test("verifyStamp(createStamp(fields)) is valid with the same fields", async () => {
  const rnd = random(7);
  for (let i = 0; i < 150; i++) {
    const fields = randomFields(rnd);
    const domain = rnd() < 0.3 ? "bücher.example" : "issuer.example";
    let stamp;
    try {
      stamp = await createStamp({ domain, keyId: "k1", privateKey: seed, issuedAt: NOW, fields });
    } catch (e) {
      assert.equal((e as { code?: string }).code, "too-large");
      continue;
    }
    const ascii = domain === "issuer.example" ? domain : "xn--bcher-kva.example";
    const result = await verifyStamp(stamp.text, { now: NOW, resolve: resolverFor(zone(ascii)) });
    assert.equal(result.outcome, "valid", result.reason);
    assert.deepEqual(result.fields, fields);
    assert.equal(result.domainUnicode, domain);
  }
});

test("mutated stamps never verify, never throw, and give the same outcome as the reference verifier", async () => {
  const rnd = random(11);
  const records = zone("issuer.example");
  const resolve = resolverFor(records);
  let cases = 0;
  for (let s = 0; s < 4; s++) {
    const stamp = await createStamp({ domain: "issuer.example", keyId: "k1", privateKey: seed, issuedAt: NOW, fields: randomFields(rnd) });
    const envelope = decodeText(stamp.text);
    const variants: Uint8Array[] = [];
    for (let i = 0; i < envelope.length; i++) {
      const changed = envelope.slice();
      changed[i] = changed[i]! ^ (1 + Math.floor(rnd() * 255));
      variants.push(changed, Uint8Array.from([...envelope.subarray(0, i), ...envelope.subarray(i + 1)]));
      variants.push(Uint8Array.from([...envelope.subarray(0, i), Math.floor(rnd() * 256), ...envelope.subarray(i)]));
    }
    for (const variant of variants) {
      const text = "DKDS:" + base45Encode(variant);
      const ours = await verifyStamp(text, { now: NOW, resolve });
      const reference = await referenceVerify(text, { now: NOW, resolve });
      assert.notEqual(ours.outcome, "valid", text);
      assert.ok(OUTCOMES.includes(ours.outcome));
      assert.equal(ours.outcome, reference.outcome, `${text}: ${ours.reason} / ${reference.reason}`);
      cases++;
    }
  }
  assert.ok(cases > 1000);
});

test("arbitrary text gives the same outcome as the reference verifier", async () => {
  const rnd = random(13);
  const resolve = resolverFor(zone("issuer.example"));
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:abc\n";
  for (let i = 0; i < 3000; i++) {
    let text = rnd() < 0.9 ? "DKDS:" : "";
    const length = Math.floor(rnd() * 120);
    for (let j = 0; j < length; j++) text += chars[Math.floor(rnd() * (rnd() < 0.98 ? 45 : chars.length))];
    const ours = await verifyStamp(text, { now: NOW, resolve });
    const reference = await referenceVerify(text, { now: NOW, resolve });
    assert.equal(ours.outcome, reference.outcome, JSON.stringify(text));
  }
});
