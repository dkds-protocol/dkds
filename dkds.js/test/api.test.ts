/**
 * The public API: input checks of createStamp, signers, keys, inspection and warnings.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { test } from "node:test";
import { base64DecodeCanonical, base64Encode } from "../src/bytes.ts";
import { punycodeDecode, punycodeEncode } from "../src/punycode.ts";
import {
  createStamp,
  DkdsError,
  generateKey,
  inspectStamp,
  keyRecord,
  keySigner,
  LIMITS,
  publicKeyOf,
  verifyStamp,
  type CreateOptions,
  type KeyStore,
  type Resolver,
} from "../src/index.ts";

const seed = new Uint8Array(32).fill(0x07);
const NOW = 1790758800;
const base: CreateOptions = { domain: "issuer.example", keyId: "k1", privateKey: seed, issuedAt: NOW, fields: [["Name", "Value"]] };

const rejectsWith = (code: string) => (e: unknown) => e instanceof DkdsError && e.code === code;

function resolverFor(records: Record<string, string>): Resolver {
  return async (name) => (records[name] ? { result: "answer", txt: [[records[name]!]], dnssec: false } : { result: "nxdomain" });
}

// ---- createStamp ------------------------------------------------------------------------------

test("createStamp rejects plain objects as fields", async () => {
  await assert.rejects(createStamp({ ...base, fields: { b: "1", 2026: "2" } as never }), rejectsWith("fields-invalid"));
});

test("createStamp accepts a Map and keeps its order", async () => {
  const fields = new Map([["2026", "a"], ["Name", "b"]]);
  const stamp = await createStamp({ ...base, fields });
  const result = await verifyStamp(stamp.text, { now: NOW, resolve: resolverFor({ "k1._dkds.issuer.example": keyRecord(publicKeyOf(seed)) }) });
  assert.deepEqual(result.fields, [["2026", "a"], ["Name", "b"]]);
});

test("createStamp normalises names and values to NFC", async () => {
  const stamp = await createStamp({ ...base, fields: [["Café", "é"]] });
  const result = await verifyStamp(stamp.text, { now: NOW, resolve: resolverFor({ "k1._dkds.issuer.example": keyRecord(publicKeyOf(seed)) }) });
  assert.deepEqual(result.fields, [["Café", "é"]]);
});

test("createStamp converts Unicode and uppercase domains to the ASCII form", async () => {
  const stamp = await createStamp({ ...base, domain: "Bücher.Example" });
  const header = inspectStamp(stamp.text);
  assert.equal(header.parsed && header.domain, "xn--bcher-kva.example");
  assert.equal(header.parsed && header.domainUnicode, "bücher.example");
});

test("createStamp checks every input rule", async () => {
  const cases: [Partial<CreateOptions>, string][] = [
    [{ domain: "localhost" }, "domain-invalid"],
    [{ domain: "issuer.example." }, "domain-invalid"],
    [{ domain: "-a.example" }, "domain-invalid"],
    [{ domain: "ab--c.example" }, "domain-invalid"],
    [{ domain: "a‮b.example" }, "domain-invalid"],
    [{ keyId: "K1" }, "key-id-invalid"],
    [{ keyId: "" }, "key-id-invalid"],
    [{ keyId: "a".repeat(17) }, "key-id-invalid"],
    [{ domain: `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(53)}` }, "lookup-name-too-long"],
    [{ fields: [] }, "fields-invalid"],
    [{ fields: Array.from({ length: 256 }, (_, i) => [`n${i}`, ""] as const) }, "fields-invalid"],
    [{ fields: [["", "x"]] }, "field-name-invalid"],
    [{ fields: [["n".repeat(256), "x"]] }, "field-name-invalid"],
    [{ fields: [["n", "x".repeat(65536)]] }, "field-value-invalid"],
    [{ fields: [["é", "1"], ["é", "2"]] }, "field-name-duplicate"],
    [{ fields: [["n", "line\nbreak"]] }, "forbidden-code-point"],
    [{ fields: [["n", "‮"]] }, "forbidden-code-point"],
    [{ fields: [["n", "\ud800"]] }, "fields-invalid"],
    [{ fields: [["n", "x".repeat(16400)]] }, "payload-too-large"],
    [{ fields: [["n", Array.from({ length: 1400 }, (_, i) => String.fromCharCode(0x4e00 + ((i * 7919) % 20000))).join("")]] }, "too-large"],
    [{ issuedAt: -1 }, "envelope-invalid"],
    [{ issuedAt: 2 ** 32 }, "envelope-invalid"],
    [{ issuedAt: 1.5 }, "envelope-invalid"],
    [{ issuedAt: Math.floor(Date.now() / 1000) + 601 }, "envelope-invalid"],
    [{ privateKey: new Uint8Array(31) }, "key-invalid"],
    [{ privateKey: "not a key" }, "key-invalid"],
  ];
  for (const [change, code] of cases) {
    await assert.rejects(createStamp({ ...base, ...change }), rejectsWith(code), `${JSON.stringify(change).slice(0, 80)} -> ${code}`);
  }
});

test("createStamp requires exactly one of privateKey and signer", async () => {
  const { privateKey: _omitted, ...withoutKey } = base;
  await assert.rejects(createStamp(withoutKey), rejectsWith("invalid-argument"));
  await assert.rejects(createStamp({ ...base, signer: keySigner(seed) }), rejectsWith("invalid-argument"));
});

test("an asynchronous signer, such as a key management service, is accepted", async () => {
  const inner = keySigner(seed);
  const { privateKey: _omitted, ...withoutKey } = base;
  const stamp = await createStamp({ ...withoutKey, signer: { publicKey: inner.publicKey, sign: async (m) => inner.sign(m) } });
  const reference = await createStamp(base);
  assert.equal(stamp.text, reference.text);
});

test("a signer whose signature does not verify is rejected", async () => {
  const other = keySigner(new Uint8Array(32).fill(0x08));
  const { privateKey: _omitted, ...withoutKey } = base;
  const cases = [
    { publicKey: publicKeyOf(seed), sign: other.sign },
    { publicKey: publicKeyOf(seed), sign: () => new Uint8Array(64) },
    { publicKey: publicKeyOf(seed), sign: () => "signature" as unknown as Uint8Array },
  ];
  for (const signer of cases) await assert.rejects(createStamp({ ...withoutKey, signer }), rejectsWith("signer-mismatch"));
});

test("the largest stamp that fits is created; its text form and QR code are within the limits", async () => {
  let lo = 0;
  let hi = 2000;
  const make = (n: number) => createStamp({ ...base, fields: [["n", Array.from({ length: n }, (_, i) => String.fromCharCode(0x4e00 + ((i * 7919) % 20000))).join("")]] });
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    try {
      await make(mid);
      lo = mid;
    } catch {
      hi = mid - 1;
    }
  }
  const stamp = await make(lo);
  assert.ok(stamp.envelope.length <= LIMITS.envelopeBytes && stamp.envelope.length > LIMITS.envelopeBytes - 4);
  assert.ok(stamp.text.length <= LIMITS.textLength);
  assert.ok(stamp.qr.version <= 27);
});

test("the SVG has the printed size of 0.33 mm per module with a quiet zone of 4 modules", async () => {
  const stamp = await createStamp(base);
  const mm = +((stamp.qr.size + 8) * 0.33).toFixed(3);
  assert.match(stamp.svg, new RegExp(`^<svg [^>]*width="${mm}mm" height="${mm}mm" viewBox="0 0 ${stamp.qr.size + 8} ${stamp.qr.size + 8}"`));
});

// ---- keys -------------------------------------------------------------------------------------

test("generateKey produces a PEM key whose public key matches", () => {
  const { privateKey, publicKey } = generateKey();
  assert.match(privateKey, /^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END PRIVATE KEY-----\n$/);
  assert.deepEqual(publicKeyOf(privateKey), publicKey);
});

test("keys generated by OpenSSL are accepted and sign identically", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const raw = new Uint8Array(publicKey.export({ format: "der", type: "spki" }).subarray(12));
  assert.deepEqual(publicKeyOf(pem), raw);
  const message = new TextEncoder().encode("DKDS test");
  assert.deepEqual(keySigner(pem).sign(message), new Uint8Array(nodeSign(null, message, privateKey)));
});

test("PKCS#8 version 2 keys are accepted when the public key matches", () => {
  const pub = publicKeyOf(seed);
  const der = (pk: Uint8Array) =>
    Uint8Array.from([0x30, 0x51, 0x02, 0x01, 0x01, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...seed, 0x81, 0x21, 0x00, ...pk]);
  const pem = (d: Uint8Array) => `-----BEGIN PRIVATE KEY-----\n${base64Encode(d)}\n-----END PRIVATE KEY-----\n`;
  assert.deepEqual(publicKeyOf(pem(der(pub))), pub);
  assert.throws(() => publicKeyOf(pem(der(new Uint8Array(32)))), rejectsWith("key-invalid"));
});

test("keyRecord formats a key and a revocation", () => {
  assert.equal(keyRecord(null), "v=DKDS1; k=ed25519; p=");
  assert.throws(() => keyRecord(new Uint8Array(31)), rejectsWith("key-invalid"));
});

// ---- encodings --------------------------------------------------------------------------------

test("Punycode reproduces the samples of RFC 3492, section 7.1", () => {
  const samples: [string, string][] = [
    ["ليهمابتكلموشعربي؟", "egbpdaj6bu4bxfgehfvwxn"],
    ["他们为什么不说中文", "ihqwcrb4cv8a8dqg056pqjye"],
    ["Pročprostěnemluvíčesky", "Proprostnemluvesky-uyb24dma41a"],
    ["なぜみんな日本語を話してくれないのか", "n8jok5ay5dzabd5bym9f0cm5685rrjetr6pdxa"],
    ["3年B組金八先生", "3B-ww4c5e180e575a65lsy2b"],
  ];
  for (const [unicode, encoded] of samples) {
    const cps = [...unicode].map((c) => c.codePointAt(0)!);
    assert.equal(punycodeEncode(cps), encoded);
    assert.deepEqual(punycodeDecode(encoded.toLowerCase())?.map((c) => String.fromCodePoint(c).toLowerCase()), cps.map((c) => String.fromCodePoint(c).toLowerCase()));
  }
});

test("Base64 decoding accepts only the canonical padded form", () => {
  assert.deepEqual(base64DecodeCanonical("AAE="), Uint8Array.of(0, 1));
  for (const bad of ["AAF=", "AAE", "AA E=", "AA-=", "A===", "AAE==", "=AAE"]) assert.equal(base64DecodeCanonical(bad), null, bad);
  for (let n = 0; n < 40; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
    assert.equal(base64Encode(bytes), Buffer.from(bytes).toString("base64"));
    assert.deepEqual(base64DecodeCanonical(base64Encode(bytes)), bytes);
  }
});

// ---- inspectStamp -----------------------------------------------------------------------------

test("inspectStamp returns the header and never the fields", async () => {
  const stamp = await createStamp(base);
  const header = inspectStamp(stamp.text);
  assert.equal(header.parsed, true);
  assert.equal("fields" in header, false);
  const rejected = inspectStamp("DKDS:A");
  assert.equal(rejected.parsed === false && rejected.outcome, "malformed");
  assert.equal(rejected.parsed === false && rejected.step, 1);
});

test("verifyStamp rejects incorrect calls and nothing else", async () => {
  await assert.rejects(verifyStamp(42 as unknown as string), rejectsWith("invalid-argument"));
  await assert.rejects(verifyStamp("DKDS:", { now: Number.NaN }), rejectsWith("invalid-argument"));
  const throwing: Resolver = async () => {
    throw new Error("network down");
  };
  const stamp = await createStamp(base);
  assert.equal((await verifyStamp(stamp.text, { now: NOW, resolve: throwing })).outcome, "unavailable");
  const invalid = (async () => ({ result: "answer" })) as unknown as Resolver;
  assert.equal((await verifyStamp(stamp.text, { now: NOW, resolve: invalid })).outcome, "unavailable");
});

// ---- warnings ---------------------------------------------------------------------------------

test("warnings: internationalised and mixed-script domains", async () => {
  const cases: [string, string[]][] = [
    ["issuer.example", []],
    ["bücher.example", ["idn"]],
    ["рaypal.example", ["idn", "mixed-script"]],
    ["日本語ひらがな.example", ["idn"]],
    ["ελληνικά.example", ["idn"]],
  ];
  for (const [domain, codes] of cases) {
    const stamp = await createStamp({ ...base, domain });
    const ascii = inspectStamp(stamp.text);
    const record = keyRecord(publicKeyOf(seed));
    const result = await verifyStamp(stamp.text, { now: NOW, resolve: resolverFor({ [`k1._dkds.${ascii.parsed && ascii.domain}`]: record }) });
    assert.equal(result.outcome, "valid");
    assert.deepEqual(result.warnings.map((w) => w.code), codes, domain);
  }
});

test("warnings: changed and disappeared keys, similar domains and a single resolver", async () => {
  const records = new Map<string, string>();
  const domains = new Set<string>();
  const store: KeyStore = {
    get: (name) => records.get(name),
    set: (name, record, domain) => {
      records.set(name, record);
      domains.add(domain);
    },
    domains: () => domains,
  };
  const stamp = await createStamp(base);
  const record = keyRecord(publicKeyOf(seed));
  const zone: Record<string, string> = { "k1._dkds.issuer.example": record };
  const codes = async (text: string, resolve: Resolver) => (await verifyStamp(text, { now: NOW, resolve, keyStore: store })).warnings.map((w) => w.code);

  assert.deepEqual(await codes(stamp.text, resolverFor(zone)), []);
  assert.equal(records.get("k1._dkds.issuer.example"), record);

  zone["k1._dkds.issuer.example"] = `${record}; n=rotated`;
  assert.deepEqual(await codes(stamp.text, resolverFor(zone)), ["key-changed"]);

  delete zone["k1._dkds.issuer.example"];
  assert.deepEqual(await codes(stamp.text, resolverFor(zone)), ["key-disappeared"]);

  const lookalike = await createStamp({ ...base, domain: "issuer-example.example" });
  const similar = await createStamp({ ...base, domain: "issuar.example" });
  zone["k1._dkds.issuar.example"] = record;
  assert.deepEqual(await codes(similar.text, resolverFor(zone)), ["similar-domain"]);
  assert.deepEqual(await codes(lookalike.text, resolverFor(zone)), []);

  const single: Resolver = async () => ({ result: "answer", txt: [[record]], dnssec: false, resolvers: 1 });
  const result = await verifyStamp(stamp.text, { now: NOW, resolve: single });
  assert.deepEqual(result.warnings.map((w) => w.code), ["single-resolver"]);
});
