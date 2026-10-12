/**
 * Specification, Appendix C: the example stamp.
 *
 * DEFLATE output is not unique, and Appendix C was compressed with zlib. The tests therefore compare the
 * field list before compression, and the envelope, signature and text form for the same compressed
 * payload.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { encodeText } from "../src/carrier/text.ts";
import { encodeSignedPart, parseEnvelope, signedMessage } from "../src/envelope.ts";
import { createStamp, keyRecord, keySigner, publicKeyOf } from "../src/index.ts";
import { encodeFieldList } from "../src/payload/fields.ts";
import { inflateRaw } from "../src/payload/inflate.ts";

const vectors = JSON.parse(readFileSync(new URL("../../spec/vectors/vectors.json", import.meta.url), "utf8"));
const example = vectors.vectors.find((v: { id: string }) => v.id === "valid-appendix-c");
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const seed = new Uint8Array(32).fill(0x07);
const header = { domain: "northwind.example", keyId: "k2026", issuedAt: 1790758800 };

test("the field list equals that of Appendix C", () => {
  assert.equal(hex(encodeFieldList(example.expected.fields)), example.intermediate.field_list);
});

test("for the payload of Appendix C, envelope, signature and text form are identical", async () => {
  const payload = parseEnvelope(Buffer.from(example.intermediate.envelope, "hex")).payload;
  const signedPart = encodeSignedPart(header, payload);
  const signature = await keySigner(seed).sign(signedMessage(signedPart));
  const envelope = Buffer.concat([signedPart, signature]);
  assert.equal(hex(envelope), example.intermediate.envelope);
  assert.equal(encodeText(envelope), example.text);
});

test("createStamp produces a stamp with the field list of Appendix C", async () => {
  const stamp = await createStamp({ ...header, privateKey: seed, fields: example.expected.fields });
  const payload = parseEnvelope(stamp.envelope).payload;
  assert.equal(hex(inflateRaw(payload, 16384)), example.intermediate.field_list);
});

test("keyRecord reproduces the key record of Appendix C", () => {
  assert.equal(keyRecord(publicKeyOf(seed)), "v=DKDS1; k=ed25519; p=6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=");
});
