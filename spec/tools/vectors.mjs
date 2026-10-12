// Generates the DKDS version 1 test vectors.
//
//   node vectors.mjs     writes ../vectors/vectors.json
//
// Every vector is built from explicit inputs by the builder below, which can
// produce both conforming and deliberately broken stamps. Output is fully
// deterministic: the keys come from fixed seeds and Ed25519 signing is
// deterministic, so running this twice produces identical files.
//
// The expected outcome of each vector is written here by hand, from the
// specification; run.mjs checks the reference verifier against it.

import { ed25519, ED25519_TORSION_SUBGROUP } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { deflateRawSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { punycodeDecode, punycodeEncode } from "./verify.mjs";

const Point = ed25519.Point;
const L = Point.Fn.ORDER;
const P = Point.Fp.ORDER;

// ---- byte helpers ---------------------------------------------------------------
const u8 = (n) => Uint8Array.of(n);
const u16 = (n) => Uint8Array.of(n >> 8, n & 255);
const u32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const utf8 = (s) => new TextEncoder().encode(s);
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const hex = (b) => Buffer.from(b).toString("hex");
const b64 = (b) => Buffer.from(b).toString("base64");
const leInt = (b) => b.reduceRight((acc, x) => (acc << 8n) | BigInt(x), 0n);
const le32 = (n) => { const o = new Uint8Array(32); for (let i = 0; i < 32; i++) { o[i] = Number(n & 255n); n >>= 8n; } return o; };
const mod = (a, m) => ((a % m) + m) % m;

// ---- Base45 (RFC 9285) -------------------------------------------------------------
const B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
function base45(buf) {
  let s = "";
  for (let i = 0; i < buf.length; i += 2) {
    if (i + 1 < buf.length) {
      let n = buf[i] * 256 + buf[i + 1];
      s += B45[n % 45]; n = Math.floor(n / 45);
      s += B45[n % 45] + B45[Math.floor(n / 45)];
    } else s += B45[buf[i] % 45] + B45[Math.floor(buf[i] / 45)];
  }
  return s;
}

// ---- keys ---------------------------------------------------------------------------
// Ed25519 from first principles (RFC 8032 5.1.5 and 5.1.6), so that signatures
// with chosen R and S can be produced for the edge-case vectors.
function makeKey(seedByte) {
  const seed = new Uint8Array(32).fill(seedByte);
  const h = sha512(seed);
  const s = h.slice(0, 32); s[0] &= 248; s[31] &= 127; s[31] |= 64;
  const a = leInt(s);
  const A = Point.BASE.multiply(mod(a, L));
  return { seed, a, prefix: h.slice(32), A, pub: A.toBytes() };
}
const K1 = makeKey(0x07);   // the key of Appendix C
const K2 = makeKey(0x08);   // a different key, for wrong-key vectors

const kOf = (Rb, Ab, M) => mod(leInt(sha512(cat(Rb, Ab, M))), L);
function signNormal(key, M) {
  const r = mod(leInt(sha512(cat(key.prefix, M))), L);
  const Rb = Point.BASE.multiply(r).toBytes();
  const S = mod(r + kOf(Rb, key.pub, M) * key.a, L);
  return cat(Rb, le32(S));
}
// cross-check the hand-written signer against the library once
{
  const M = ascii("check");
  const sig = signNormal(K1, M);
  if (hex(sig) !== hex(ed25519.sign(M, K1.seed))) throw new Error("signer disagrees with RFC 8032");
}

// ---- records ------------------------------------------------------------------------
const recordFor = (key) => `v=DKDS1; k=ed25519; p=${b64(key.pub)}`;

// ---- the builder ----------------------------------------------------------------------
const DOMAIN = "northwind.example", KEYID = "k2026";
const ISSUED = 1790758800;                 // 2026-09-30T09:00:00Z
const NOW = 1790800000;                    // the verifier's clock in every vector
const FIELDS = [
  ["Supplier", "Northwind B.V."],
  ["Invoice no.", "2026-0917"],
  ["Date", "2026-09-30"],
  ["Customer", "Harbour Logistics B.V."],
  ["Amount", "4,812.50 EUR"],
  ["Pay to IBAN", "NL91 ABNA 0417 1643 00"],
  ["Due", "2026-10-30"],
];

function fieldList(fields) {
  return cat(u8(fields.length), ...fields.flatMap(([n, v]) => {
    const nb = typeof n === "string" ? utf8(n) : n, vb = typeof v === "string" ? utf8(v) : v;
    return [u8(nb.length), nb, u16(vb.length), vb];
  }));
}
const deflate = (b) => new Uint8Array(deflateRawSync(b, { level: 9 }));

// Build a stamp. Every part can be overridden to produce a broken one.
function build(o = {}) {
  const domain = o.domain ?? DOMAIN, keyId = o.keyId ?? KEYID;
  const list = o.list ?? fieldList(o.fields ?? FIELDS);
  const payload = o.payload ?? deflate(list);
  const head = cat(
    u8(o.version ?? 1),
    u8(o.domainLen ?? domain.length), ascii(domain),
    u8(o.keyidLen ?? keyId.length), ascii(keyId),
    u32(o.issuedAt ?? ISSUED),
    u16(o.payloadLen ?? payload.length), payload,
  );
  const message = cat(ascii(o.context ?? "DKDS"), head);
  const signature = o.signature ? o.signature({ head, message }) : signNormal(o.key ?? K1, message);
  const envelope = cat(head, signature);
  return { head, message, signature, envelope, list, text: "DKDS:" + base45(envelope) };
}

// ---- vectors ----------------------------------------------------------------------------
const vectors = [];
const keyRecordAt = (name, record = recordFor(K1), extra = {}) => ({ [name]: { result: "answer", txt: [[record]], dnssec: false, ...extra } });
const DEFAULT_NAME = `${KEYID}._dkds.${DOMAIN}`;

function add(id, section, description, text, { dns = keyRecordAt(DEFAULT_NAME), expect, queries, built }) {
  const v = { id, section, description, text, now: NOW, dns, expected: { outcome: expect.outcome } };
  v.expected.queries = queries ?? [];
  if (expect.outcome === "valid") {
    Object.assign(v.expected, {
      domain: expect.domain ?? DOMAIN,
      domain_unicode: expect.domain_unicode ?? expect.domain ?? DOMAIN,
      key_id: expect.key_id ?? KEYID,
      issued_at: expect.issued_at ?? ISSUED,
      dnssec: expect.dnssec ?? false,
      fields: expect.fields ?? FIELDS,
    });
    if (built) v.intermediate = { envelope: hex(built.envelope), message: hex(built.message), field_list: hex(built.list) };
  }
  vectors.push(v);
}
// shorthands: a stamp that reaches DNS queries the default name; one that does not, queries nothing
const reaches = (name = DEFAULT_NAME) => [name];
const valid = (id, section, description, o = {}, expect = {}, dns) => {
  const b = build(o);
  const name = `${o.keyId ?? KEYID}._dkds.${o.domain ?? DOMAIN}`;
  add(id, section, description, b.text, {
    dns: dns ?? keyRecordAt(name, recordFor(o.key ?? K1)),
    expect: { outcome: "valid", ...expect }, queries: reaches(name), built: b,
  });
};
const malformedEarly = (id, section, description, text) =>
  add(id, section, description, text, { expect: { outcome: "malformed" }, queries: [] });

// ===== valid stamps =====================================================================
valid("valid-appendix-c", "Appendix C", "The example of Appendix C.");
valid("valid-single-field-empty-value", "5.1", "One field with an empty value.",
  { fields: [["Note", ""]] }, { fields: [["Note", ""]] });
{
  const f = [["Naam", "Jürgen Ölçek"], ["Адрес", "Москва"], ["名前", "山田太郎"], ["שם", "דוד"], ["الاسم", "محمد"], ["Family", "👩‍👩‍👧"], ["Joined", "a‌b‍c"]];
  valid("valid-unicode-fields", "5.2, Appendix B", "Non-Latin scripts, right-to-left letters, an emoji sequence with zero-width joiners, and a zero-width non-joiner. None of these is forbidden.", { fields: f }, { fields: f });
}
{
  const f = [["Edge", " ﷏ﷰ�\u{1fffd}\u{10fffd}"]];
  valid("valid-codepoints-next-to-forbidden", "Appendix B", "Code points adjacent to the forbidden ranges: U+00A0, U+FDCF, U+FDF0, U+FFFD, U+1FFFD, U+10FFFD.", { fields: f }, { fields: f });
}
{
  const f = [["Emoji", "❤\ufe0f"], ["Kanji", "葛\u{e0100}"], ["Mongolian", "ᠠ\u180b"]];
  valid("valid-variation-selectors", "Appendix B", "Variation selectors, which are allowed: U+FE0F after an emoji, U+E0100 after a kanji and U+180B, a Mongolian variation selector.", { fields: f }, { fields: f });
}
valid("valid-idn-domain", "4.2", "An internationalised domain: xn--mnchen-3ya.example, whose Unicode form is münchen.example.",
  { domain: "xn--mnchen-3ya.example" }, { domain: "xn--mnchen-3ya.example", domain_unicode: "münchen.example" });
valid("valid-key-id-16", "4.3", "A key ID of the maximum length, 16 characters.",
  { keyId: "abcdefghij012345" }, { key_id: "abcdefghij012345" });
valid("valid-label-63", "4.2", "A domain label of the maximum length, 63 characters.",
  { domain: "a".repeat(63) + ".example" }, { domain: "a".repeat(63) + ".example" });
{
  // lookup name of exactly 253 characters: "k2026._dkds." is 12 characters
  const labels = ["a".repeat(63), "b".repeat(63), "c".repeat(63)];
  const rest = 253 - 12 - (63 * 3 + 3);
  const domain = [...labels, "d".repeat(rest)].join(".");
  if (`${KEYID}._dkds.${domain}`.length !== 253) throw new Error("lookup length");
  valid("valid-lookup-name-253", "4.2", "A lookup name of exactly 253 characters, the maximum.", { domain }, { domain });
}
valid("valid-issued-now-plus-600", "8.2 step 5", "Issued exactly 600 seconds after the verifier's clock: the maximum tolerance.",
  { issuedAt: NOW + 600 }, { issued_at: NOW + 600 });
valid("valid-issued-epoch", "4.1", "Issued at time 0 (1970-01-01T00:00:00Z).", { issuedAt: 0 }, { issued_at: 0 });
{
  const f = Array.from({ length: 255 }, (_, i) => [`f${i}`, ""]);
  valid("valid-255-fields", "5.1", "255 fields, the maximum.", { fields: f }, { fields: f });
}
{
  const name = "n".repeat(255);
  valid("valid-name-255-bytes", "5.1", "A field name of 255 bytes, the maximum.", { fields: [[name, "v"]] }, { fields: [[name, "v"]] });
}
{
  // decompressed field list of exactly 16,384 bytes: 1 + 1 + 1 + 2 + value
  const value = "a".repeat(16384 - 5);
  valid("valid-inflated-16384", "5.2", "A field list of exactly 16,384 bytes after decompression, the maximum.",
    { fields: [["x", value]] }, { fields: [["x", value]] });
}
{
  // an envelope of exactly 1,088 bytes: grow an incompressible value until it fits
  let s = 0x1234567, filler = "";
  const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff);
  let b;
  for (;;) {
    filler += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[next() % 62];
    b = build({ fields: [["Data", filler]] });
    if (b.envelope.length >= 1088) break;
  }
  if (b.envelope.length !== 1088 || b.text.length !== 1637) throw new Error(`max envelope ${b.envelope.length}`);
  valid("valid-envelope-1088", "3.1, 4.1", "An envelope of exactly 1,088 bytes, whose text form is exactly 1,637 characters: the maximum.",
    { fields: [["Data", filler]] }, { fields: [["Data", filler]] });
  // one byte more than the maximum
  const over = cat(b.head, b.signature, u8(0));
  if (5 + base45(over).length !== 1639) throw new Error("text of 1,089 bytes");
  malformedEarly("carrier-text-1639", "3.1", "An envelope of 1,089 bytes; its text form is 1,639 characters, above the 1,637 maximum.", "DKDS:" + base45(over));
}

// ===== DNS record forms that are valid =================================================
valid("valid-record-split-strings", "7.2", "The TXT record consists of three character strings, joined without separators.",
  {}, {}, { [DEFAULT_NAME]: { result: "answer", txt: [["v=DKDS1; k=ed", "25519; p=", b64(K1.pub)]], dnssec: false } });
valid("valid-record-whitespace", "7.2", "Spaces and tabs around names, values and separators, and a final separator.",
  {}, {}, { [DEFAULT_NAME]: { result: "answer", txt: [[` v = DKDS1 ;\tk=ed25519;p =\t${b64(K1.pub)} ; `]], dnssec: false } });
valid("valid-record-unknown-tag", "7.2", "An unknown tag is ignored.",
  {}, {}, keyRecordAt(DEFAULT_NAME, `v=DKDS1; k=ed25519; n=Payroll key 2026; p=${b64(K1.pub)}`.replace("Payroll key 2026", "payroll-2026")));
valid("valid-record-among-others", "7.3", "The name also holds an unrelated TXT record, which is not considered.",
  {}, {}, { [DEFAULT_NAME]: { result: "answer", txt: [["v=spf1 -all"], [recordFor(K1)]], dnssec: false } });
valid("valid-dnssec", "9.1", "The DNS answer was validated with DNSSEC; the verifier reports it.",
  {}, { dnssec: true }, keyRecordAt(DEFAULT_NAME, recordFor(K1), { dnssec: true }));
valid("valid-cname", "7.1", "The lookup name is a CNAME to a name at a signing service; the verifier follows it.",
  {}, {}, { [DEFAULT_NAME]: { result: "cname", target: "northwind.keys.signing-service.example" },
           "northwind.keys.signing-service.example": { result: "answer", txt: [[recordFor(K1)]], dnssec: false } });
valid("valid-cname-dnssec", "7.1, 9.2", "The lookup name is a CNAME, and the answer, including the CNAME, was validated with DNSSEC.",
  {}, { dnssec: true }, { [DEFAULT_NAME]: { result: "cname", target: "northwind.keys.signing-service.example" },
           "northwind.keys.signing-service.example": { result: "answer", txt: [[recordFor(K1)]], dnssec: true } });
valid("valid-record-v-invalid-not-considered", "7.3", "Beside the key record, a record whose text before the first ; is v=DKDS1 x, which does not match the tag rule. It is not considered.",
  {}, {}, { [DEFAULT_NAME]: { result: "answer", txt: [[`v=DKDS1 x; k=ed25519; p=`], [recordFor(K1)]], dnssec: false } });

// ===== carrier: malformed (3) ===========================================================
const base = build();
malformedEarly("carrier-no-prefix", "3.1", "The text has no prefix.", base.text.slice(5));
malformedEarly("carrier-prefix-lowercase", "3.1", "The prefix is in lowercase.", "dkds:" + base.text.slice(5));
malformedEarly("carrier-prefix-old", "3.1", "The prefix DKDS1: instead of DKDS:.", "DKDS1:" + base.text.slice(5));
malformedEarly("carrier-leading-space", "3.1", "A space before the prefix.", " " + base.text);
malformedEarly("carrier-trailing-newline", "3.1", "A line feed after the text, as some scanner apps add.", base.text + "\n");
malformedEarly("carrier-lowercase-base45", "3.2", "A lowercase letter in the Base45 text.", base.text.slice(0, 10) + base.text[10].toLowerCase() + base.text.slice(11));
malformedEarly("carrier-invalid-character", "3.2", "A character outside the Base45 alphabet (#).", base.text.slice(0, 10) + "#" + base.text.slice(11));
malformedEarly("carrier-group-above-65535", "3.2", "A final three-character group, GGW, whose value 65,536 is above 65,535.", base.text + "GGW");
malformedEarly("carrier-final-single-character", "3.2", "A final group of one character.", base.text + "0");
malformedEarly("carrier-final-pair-above-255", "3.2", "A final two-character group, GG, whose value 736 is above 255.", base.text + "GG");
malformedEarly("carrier-empty", "8.2 step 2", "The prefix with nothing after it: an empty envelope.", "DKDS:");

// ===== envelope: version (4.4) ==========================================================
malformedEarly("envelope-version-00", "4.4", "Version byte 0x00, reserved.", build({ version: 0 }).text);
malformedEarly("envelope-version-ff", "4.4", "Version byte 0xFF, reserved.", build({ version: 0xff }).text);
add("envelope-version-02", "4.4", "Version byte 0x02, a version this specification does not define.",
  build({ version: 2 }).text, { expect: { outcome: "unsupported" }, queries: [] });
add("envelope-version-02-garbage", "4.4", "Version byte 0x02 followed by bytes that are not a version 1 envelope. A verifier does not parse further.",
  "DKDS:" + base45(Uint8Array.of(2, 0xde, 0xad, 0xbe, 0xef)), { expect: { outcome: "unsupported" }, queries: [] });

// ===== envelope: structure (4.1) ========================================================
malformedEarly("envelope-domain-len-0", "4.2", "domain_len is 0.", build({ domain: "" }).text);
malformedEarly("envelope-domain-len-overrun", "4.1", "domain_len points past the end of the envelope.",
  "DKDS:" + base45(Uint8Array.of(1, 200, 0x61, 0x62)));
malformedEarly("envelope-truncated-header", "4.1", "The envelope ends inside issued_at.",
  "DKDS:" + base45(cat(u8(1), u8(DOMAIN.length), ascii(DOMAIN), u8(5), ascii(KEYID), Uint8Array.of(0x6a, 0xbc))));
malformedEarly("envelope-payload-len-0", "4.1", "payload_len is 0.", build({ payload: new Uint8Array(0) }).text);
{
  const b = build();
  const noSig = b.head;   // envelope ends exactly after the payload
  malformedEarly("envelope-no-signature", "4.1", "The envelope ends exactly after the payload: no signature bytes.", "DKDS:" + base45(noSig));
  const overrun = build({ payloadLen: 1000 });
  malformedEarly("envelope-payload-len-overrun", "4.1", "payload_len points past the end of the envelope.", overrun.text);
}

// ===== envelope: domain (4.2) ===========================================================
const badDomain = (id, description, domain) => malformedEarly(id, "4.2", description, build({ domain }).text);
badDomain("domain-uppercase", "An uppercase letter in the domain.", "Northwind.example");
badDomain("domain-trailing-dot", "A trailing dot.", "northwind.example.");
badDomain("domain-single-label", "A single label.", "localhost");
badDomain("domain-empty-label", "An empty label between two dots.", "northwind..example");
badDomain("domain-leading-hyphen", "A label beginning with a hyphen.", "-northwind.example");
badDomain("domain-trailing-hyphen", "A label ending with a hyphen.", "northwind-.example");
badDomain("domain-label-64", "A label of 64 characters.", "a".repeat(64) + ".example");
badDomain("domain-underscore", "An underscore in a label.", "north_wind.example");
badDomain("domain-space", "A space in a label.", "north wind.example");
badDomain("domain-reserved-label", "Hyphens in the third and fourth position without xn--.", "ab--cd.example");
badDomain("domain-xn-ascii-only", "xn--abc-, an xn-- label that decodes to ASCII only. Every such label ends with a hyphen, so the hyphen rule rejects it.", "xn--abc-.example");
badDomain("domain-xn-empty", "xn--, with nothing after the prefix. It ends with a hyphen.", "xn--.example");
{
  // find a tail that is not valid Punycode (an overflow), and one that decodes to a forbidden code point
  const invalid = "99999999999";
  if (punycodeDecode(invalid) !== null) throw new Error("expected invalid punycode");
  badDomain("domain-xn-invalid-punycode", "An xn-- label that is not valid Punycode: it ends inside a variable-length integer, whose value already exceeds 32 bits.", `xn--${invalid}.example`);
  if (punycodeDecode("a-rc4g") !== null || punycodeEncode([0x61, 0xd800]) !== "a-rc4g") throw new Error("expected a surrogate");
  badDomain("domain-xn-surrogate", "xn--a-rc4g, an xn-- label whose Punycode decodes to a followed by U+D800, a surrogate.", "xn--a-rc4g.example");
  badDomain("domain-xn-delimiter-first", "xn---abc, an xn-- label whose Punycode begins with the delimiter. RFC 3492 decoding fails; a lenient decoder that accepts it fails the round-trip rule.", "xn---abc.example");
  const rlo = punycodeEncode([0x61, 0x202e, 0x62]);
  badDomain("domain-xn-forbidden", "An xn-- label that decodes to a string containing U+202E, a right-to-left override.", `xn--${rlo}.example`);
  badDomain("domain-xn-invisible", "An xn-- label that decodes to pay, U+200B (a zero-width space) and pal, which displays as paypal.", `xn--${punycodeEncode([...("pay\u200bpal")].map((c) => c.codePointAt(0)))}.example`);
  for (const [cp, name] of [[0x3002, "ideographic"], [0xff0e, "fullwidth"], [0xff61, "halfwidth-ideographic"]]) {
    const tail = punycodeEncode([0x61, cp, 0x62]);
    badDomain(`domain-xn-${name}-full-stop`, `An xn-- label that decodes to a, U+${cp.toString(16).toUpperCase()} and b. The full stop displays like a dot, so the label would look like two labels.`, `xn--${tail}.example`);
  }
}
{
  const labels = ["a".repeat(63), "b".repeat(63), "c".repeat(63)];
  const domain = [...labels, "d".repeat(253 - 12 - (63 * 3 + 3) + 1)].join(".");
  malformedEarly("domain-lookup-name-254", "4.2", "A lookup name of 254 characters, one above the maximum.", build({ domain }).text);
}

// ===== envelope: key ID (4.3) ===========================================================
const badKey = (id, description, keyId) => malformedEarly(id, "4.3", description, build({ keyId }).text);
badKey("keyid-empty", "An empty key ID.", "");
badKey("keyid-17", "A key ID of 17 characters.", "abcdefghij0123456");
badKey("keyid-uppercase", "An uppercase letter in the key ID.", "K2026");
badKey("keyid-hyphen", "A hyphen in the key ID.", "k-2026");

// ===== clock (8.2 step 5) ===============================================================
malformedEarly("clock-now-plus-601", "8.2 step 5", "Issued 601 seconds after the verifier's clock, one second above the tolerance.", build({ issuedAt: NOW + 601 }).text);

// ===== DNS (7) ===========================================================================
const dnsCase = (id, section, description, dns, outcome) =>
  add(id, section, description, base.text, { dns, expect: { outcome }, queries: reaches() });
const rec = (r) => keyRecordAt(DEFAULT_NAME, r);
dnsCase("dns-nxdomain", "8.2 step 6", "The lookup name does not exist.", { [DEFAULT_NAME]: { result: "nxdomain" } }, "key-not-found");
dnsCase("dns-no-txt", "7.3", "The name exists but holds no TXT records.", { [DEFAULT_NAME]: { result: "answer", txt: [], dnssec: false } }, "key-not-found");
dnsCase("dns-only-unrelated", "7.3", "The name holds only an unrelated TXT record.", { [DEFAULT_NAME]: { result: "answer", txt: [["v=spf1 -all"]], dnssec: false } }, "key-not-found");
dnsCase("dns-two-records", "7.3", "Two records with v=DKDS1, even though both hold the same key.",
  { [DEFAULT_NAME]: { result: "answer", txt: [[recordFor(K1)], [recordFor(K1)]], dnssec: false } }, "key-not-found");
dnsCase("dns-failure", "8.2 step 6", "No DNS answer could be obtained (timeout, server failure, DNSSEC failure or disagreeing resolvers).",
  { [DEFAULT_NAME]: { result: "failure" } }, "unavailable");
dnsCase("dns-cname-nxdomain", "7.1", "The lookup name is a CNAME to a name that does not exist.",
  { [DEFAULT_NAME]: { result: "cname", target: "northwind.keys.signing-service.example" }, "northwind.keys.signing-service.example": { result: "nxdomain" } }, "key-not-found");
dnsCase("dns-cname-failure", "7.1", "The lookup name is a CNAME to a name for which no answer is obtained.",
  { [DEFAULT_NAME]: { result: "cname", target: "northwind.keys.signing-service.example" }, "northwind.keys.signing-service.example": { result: "failure" } }, "unavailable");
dnsCase("record-v1-unparsable-beside-valid", "7.3", "Beside the key record, a record that begins with v=DKDS1 but does not parse. Both are considered, so there is no single usable record.",
  { [DEFAULT_NAME]: { result: "answer", txt: [["v=DKDS1; garbage"], [recordFor(K1)]], dnssec: false } }, "key-not-found");
dnsCase("record-v-not-first", "7.2", "v=DKDS1 is not the first tag.", rec(`k=ed25519; v=DKDS1; p=${b64(K1.pub)}`), "key-not-found");
dnsCase("record-v-uppercase-name", "7.2", "The tag name V in uppercase; tag names are case-sensitive.", rec(`V=DKDS1; k=ed25519; p=${b64(K1.pub)}`), "key-not-found");
dnsCase("record-v-lowercase-value", "7.2", "The value dkds1 in lowercase.", rec(`v=dkds1; k=ed25519; p=${b64(K1.pub)}`), "key-not-found");
dnsCase("record-v-other-version", "7.3", "A record of another version, v=DKDS2, is not considered.", rec(`v=DKDS2; k=ed25519; p=${b64(K1.pub)}`), "key-not-found");
dnsCase("record-duplicate-tag", "7.2", "The tag p appears twice.", rec(`v=DKDS1; k=ed25519; p=${b64(K1.pub)}; p=${b64(K1.pub)}`), "key-not-found");
dnsCase("record-missing-k", "7.2", "The required tag k is missing.", rec(`v=DKDS1; p=${b64(K1.pub)}`), "key-not-found");
dnsCase("record-missing-p", "7.2", "The required tag p is missing.", rec("v=DKDS1; k=ed25519"), "key-not-found");
dnsCase("record-tag-without-equals", "7.2", "A tag without =.", rec(`v=DKDS1; k=ed25519; note; p=${b64(K1.pub)}`), "key-not-found");
dnsCase("record-space-inside-value", "7.2", "A space inside the value of p.", rec(`v=DKDS1; k=ed25519; p=${b64(K1.pub).slice(0, 20)} ${b64(K1.pub).slice(20)}`), "key-not-found");
dnsCase("record-p-unpadded", "7.2", "The key in Base64 without its padding.", rec(`v=DKDS1; k=ed25519; p=${b64(K1.pub).replace(/=+$/, "")}`), "key-not-found");
dnsCase("record-p-31-bytes", "7.2", "The key decodes to 31 bytes.", rec(`v=DKDS1; k=ed25519; p=${b64(K1.pub.slice(0, 31))}`), "key-not-found");
dnsCase("record-p-base64url", "7.2", "The key in the URL-safe Base64 alphabet, which is not allowed.",
  rec(`v=DKDS1; k=ed25519; p=${b64(K1.pub).replace(/\+/g, "-").replace(/\//g, "_")}`), "key-not-found");
dnsCase("record-p-non-canonical", "7.2", "The key in Base64 whose unused final bits are not zero; it decodes to the correct 32 bytes but is not the canonical encoding.",
  rec(`v=DKDS1; k=ed25519; p=${b64(K1.pub).replace(/(.)=$/, (_, c) => String.fromCharCode(c.charCodeAt(0) + 1) + "=")}`), "key-not-found");
dnsCase("record-revoked", "7.4", "The key is revoked: p is empty.", rec("v=DKDS1; k=ed25519; p="), "key-revoked");
dnsCase("record-unknown-algorithm", "8.2 step 8", "An algorithm the verifier does not implement, ed448.", rec(`v=DKDS1; k=ed448; p=${b64(K1.pub)}`), "unsupported");
dnsCase("record-algorithm-case", "7.2", "ED25519 in uppercase; algorithm names are case-sensitive.", rec(`v=DKDS1; k=ED25519; p=${b64(K1.pub)}`), "unsupported");
dnsCase("record-unknown-algorithm-invalid-key", "7.3, 8.2 step 8", "An unknown algorithm with a value of p that is not Base64. The value of p is checked only for an implemented algorithm.", rec("v=DKDS1; k=ed448; p=!!!"), "unsupported");
dnsCase("record-unknown-tag-non-ascii", "7.2, 11", "An unknown tag whose value contains a non-ASCII character, n=café. The value is outside the value rule, so the record does not parse.", rec(`v=DKDS1; k=ed25519; n=café; p=${b64(K1.pub)}`), "key-not-found");

// ===== signature (6) ======================================================================
const sigCase = (id, description, o, dns) => {
  const b = build(o);
  add(id, "6.3", description, b.text, { dns: dns ?? keyRecordAt(DEFAULT_NAME), expect: { outcome: "invalid-signature" }, queries: reaches() });
  return b;
};
sigCase("signature-wrong-key", "Signed with a different key than the one published.", { key: K2 });
sigCase("signature-no-context", "Signed without the DKDS prefix in the signed message (6.1).", { context: "" });
sigCase("signature-old-context", "Signed with the domain separator DKDS1: instead of DKDS.", { context: "DKDS1:" });
{
  const b = build();
  const tampered = cat(b.head, b.signature);
  tampered[1 + 1 + DOMAIN.length + 1 + KEYID.length + 4 + 2 + 10] ^= 0x01;   // the 11th payload byte
  add("signature-payload-altered", "6.3", "One payload bit changed after signing.", "DKDS:" + base45(tampered),
    { expect: { outcome: "invalid-signature" }, queries: reaches() });
  const t2 = cat(b.head, b.signature);
  t2[1 + 1 + DOMAIN.length + 1 + KEYID.length + 3] ^= 0x01;   // last byte of issued_at
  add("signature-time-altered", "6.3", "issued_at changed by one second after signing.", "DKDS:" + base45(t2),
    { expect: { outcome: "invalid-signature" }, queries: reaches() });
  add("signature-63-bytes", "6.3", "A signature of 63 bytes (check 1).", "DKDS:" + base45(cat(b.head, b.signature.slice(0, 63))),
    { expect: { outcome: "invalid-signature" }, queries: reaches() });
  add("signature-65-bytes", "6.3", "A valid signature followed by one extra byte: 65 bytes (check 1).", "DKDS:" + base45(cat(b.head, b.signature, u8(0))),
    { expect: { outcome: "invalid-signature" }, queries: reaches() });
}
sigCase("signature-s-plus-l", "S replaced by S + L. The signature is otherwise valid, so libraries that omit check 2 accept it.",
  { signature: ({ message }) => { const s = signNormal(K1, message); return cat(s.slice(0, 32), le32(leInt(s.slice(32)) + L)); } });
{
  // R = identity, S = k·a: satisfies the cofactorless equation, fails check 4
  const smallR = (Rb) => ({ message }) => cat(Rb, le32(mod(kOf(Rb, K1.pub, message) * K1.a, L)));
  sigCase("signature-r-identity", "R is the identity point, a point of small order (check 4). The equation [S]B - [k]A = R holds.",
    { signature: smallR(Point.ZERO.toBytes()) });
  const idNonCanonical = le32(P + 1n);                      // y = p + 1, x sign 0: the identity, non-canonically
  sigCase("signature-r-non-canonical", "R is the identity encoded with y = p + 1, a non-canonical encoding (check 3).",
    { signature: smallR(idNonCanonical) });
  const negZero = Point.ZERO.toBytes(); negZero[31] |= 0x80;
  sigCase("signature-r-negative-zero", "R is the identity encoded with the sign bit set while x = 0, a non-canonical encoding (check 3).",
    { signature: smallR(negZero) });
}
{
  // R with a small-order component: valid under the cofactored equation, not the cofactorless one
  const T = Point.fromBytes(Buffer.from(ED25519_TORSION_SUBGROUP[1], "hex"));
  sigCase("signature-r-mixed-order", "R = [r]B + T, where T has order 8, and S = r + k·a. Cofactored verifiers accept it; the cofactorless equation required by check 5 does not hold.",
    { signature: ({ message }) => {
      const r = 123456789n;
      const Rb = Point.BASE.multiply(r).add(T).toBytes();
      return cat(Rb, le32(mod(r + kOf(Rb, K1.pub, message) * K1.a, L)));
    } });
}
{
  // the identity as public key: in a lenient verifier, any R = [r]B with S = r verifies any message
  const universal = ({ message }) => { const r = 987654321n; return cat(Point.BASE.multiply(r).toBytes(), le32(r)); };
  const idKey = Point.ZERO.toBytes();
  add("signature-key-identity", "6.3", "The published key is the identity point, of small order (check 4). With it, a lenient verifier accepts R = [r]B, S = r for any message.",
    build({ signature: universal }).text,
    { dns: rec(`v=DKDS1; k=ed25519; p=${b64(idKey)}`), expect: { outcome: "invalid-signature" }, queries: reaches() });
  const idKeyNonCanonical = le32(P + 1n);
  add("signature-key-non-canonical", "6.3", "The published key is the identity encoded with y = p + 1, a non-canonical encoding (check 3).",
    build({ signature: universal }).text,
    { dns: rec(`v=DKDS1; k=ed25519; p=${b64(idKeyNonCanonical)}`), expect: { outcome: "invalid-signature" }, queries: reaches() });
  const T2 = Point.fromBytes(Buffer.from(ED25519_TORSION_SUBGROUP[4], "hex"));   // order 2
  add("signature-key-order-2", "6.3", "The published key is the point of order 2 (check 4).",
    build({ signature: universal }).text,
    { dns: rec(`v=DKDS1; k=ed25519; p=${b64(T2.toBytes())}`), expect: { outcome: "invalid-signature" }, queries: reaches() });
}
{
  // A with a small-order component, A' = A + T. Not of small order, so allowed as a key.
  // [S]B - [k]A' = R - [k]T, which equals R exactly when k is a multiple of 8.
  const T = Point.fromBytes(Buffer.from(ED25519_TORSION_SUBGROUP[1], "hex"));
  const Amix = K1.A.add(T), Ab = Amix.toBytes();
  const record = `v=DKDS1; k=ed25519; p=${b64(Ab)}`;
  const signMixed = (wantMultipleOf8) => ({ message }) => {
    for (let r = 1n; ; r++) {
      const Rb = Point.BASE.multiply(r).toBytes();
      const k = kOf(Rb, Ab, message);
      if ((k % 8n === 0n) === wantMultipleOf8) return cat(Rb, le32(mod(r + k * K1.a, L)));
    }
  };
  const ok = build({ signature: signMixed(true) });
  add("signature-key-mixed-order-k0", "6.3", "The key has a small-order component (A + T, T of order 8) and k is a multiple of 8, so [S]B - [k]A = R holds exactly. Mixed-order keys are not rejected; the outcome is valid.",
    ok.text, { dns: rec(record), expect: { outcome: "valid", fields: FIELDS }, queries: reaches() });
  vectors[vectors.length - 1].intermediate = { envelope: hex(ok.envelope), message: hex(ok.message), field_list: hex(ok.list) };
  const nok = build({ signature: signMixed(false) });
  add("signature-key-mixed-order-k1", "6.3", "The same mixed-order key with k not a multiple of 8. Cofactored verifiers accept it; the cofactorless equation does not hold.",
    nok.text, { dns: rec(record), expect: { outcome: "invalid-signature" }, queries: reaches() });
}

// ===== payload (5), each with a valid signature ============================================
const payloadCase = (id, section, description, o) => {
  const b = build(o);
  add(id, section, description, b.text, { expect: { outcome: "malformed" }, queries: reaches() });
};
const listOf = (...parts) => cat(...parts);
payloadCase("payload-not-deflate", "5.2", "The payload is not a DEFLATE stream.", { payload: Uint8Array.of(0xff, 0xff, 0xff) });
{
  const d = deflate(fieldList(FIELDS));
  payloadCase("payload-trailing-after-deflate", "5.2", "A byte after the end of the DEFLATE stream.", { payload: cat(d, u8(0)) });
  payloadCase("payload-truncated-deflate", "5.2", "The DEFLATE stream is cut off before its final block ends.", { payload: d.slice(0, d.length - 4) });
}
payloadCase("payload-deflate-block-type-3", "5.2", "A DEFLATE block of the reserved type 3.", { payload: Uint8Array.of(0x07, 0x00) });
payloadCase("payload-deflate-stored-length", "5.2", "A stored DEFLATE block whose LEN is 1 and NLEN is 0 instead of 0xFFFE.", { payload: Uint8Array.of(0x01, 0x01, 0x00, 0x00, 0x00, 0x41) });
payloadCase("payload-deflate-distance-too-far", "5.2", "A fixed-Huffman DEFLATE block that begins with a match of distance 1, before any output.", { payload: Uint8Array.of(0x03, 0x02, 0x00) });
payloadCase("payload-deflate-over-subscribed", "5.2", "A dynamic DEFLATE block whose code length code has four codes of length 1: an over-subscribed code.", { payload: Uint8Array.of(0x05, 0x00, 0x92, 0x04, 0x00) });
payloadCase("payload-inflated-16385", "5.2", "A field list of 16,385 bytes after decompression, one above the maximum.",
  { fields: [["x", "a".repeat(16385 - 5)]] });
payloadCase("payload-zip-bomb", "5.2", "A payload that decompresses to 1,000,000 bytes. The decoder must stop at 16,384.",
  { payload: deflate(new Uint8Array(1000000)) });
payloadCase("payload-zero-fields", "5.1", "count is 0.", { list: u8(0) });
payloadCase("payload-count-too-high", "5.2", "count is 2, but the list holds one field.", { list: listOf(u8(2), u8(1), ascii("a"), u16(1), ascii("b")) });
payloadCase("payload-trailing-after-list", "5.2", "A byte after the last field.", { list: cat(fieldList([["a", "b"]]), u8(0)) });
payloadCase("payload-empty-name", "5.1", "A field with an empty name.", { list: listOf(u8(1), u8(0), u16(1), ascii("b")) });
payloadCase("payload-duplicate-name", "5.2", "Two fields with the same name.", { fields: [["Amount", "1"], ["Amount", "2"]] });
payloadCase("payload-value-overrun", "5.2", "value_len points past the end of the field list.", { list: listOf(u8(1), u8(1), ascii("a"), u16(50), ascii("b")) });
const badUtf8 = (id, description, bytes) => payloadCase(id, "5.2", description, { list: listOf(u8(1), u8(1), ascii("a"), u16(bytes.length), bytes) });
badUtf8("utf8-overlong", "An overlong UTF-8 encoding of / (C0 AF).", Uint8Array.of(0xc0, 0xaf));
badUtf8("utf8-surrogate", "A UTF-16 surrogate encoded in UTF-8 (ED A0 80).", Uint8Array.of(0xed, 0xa0, 0x80));
badUtf8("utf8-truncated", "A truncated three-byte sequence (E2 82).", Uint8Array.of(0xe2, 0x82));
badUtf8("utf8-invalid-byte", "The byte FF, which never occurs in UTF-8.", Uint8Array.of(0x41, 0xff));
badUtf8("utf8-above-10ffff", "A four-byte sequence above U+10FFFF (F4 90 80 80).", Uint8Array.of(0xf4, 0x90, 0x80, 0x80));
{
  const forbidden = [
    [0x0000, "NULL"], [0x0009, "a tab"], [0x000a, "a line feed"], [0x000d, "a carriage return"], [0x001f, "the last C0 control"],
    [0x007f, "DELETE"], [0x0085, "NEXT LINE, a C1 control"], [0x009f, "the last C1 control"],
    [0x061c, "the Arabic letter mark"], [0x200e, "the left-to-right mark"], [0x200f, "the right-to-left mark"],
    [0x202a, "a left-to-right embedding"], [0x202e, "a right-to-left override"], [0x2066, "a left-to-right isolate"], [0x2069, "a pop directional isolate"],
    [0x2028, "the line separator"], [0x2029, "the paragraph separator"], [0xfeff, "the byte order mark"],
    [0xfdd0, "the first noncharacter of the U+FDD0 block"], [0xfdef, "the last noncharacter of the U+FDD0 block"],
    [0xfffe, "U+FFFE"], [0xffff, "U+FFFF"], [0x1fffe, "U+1FFFE"], [0x10ffff, "U+10FFFF"],
    [0x00ad, "the soft hyphen"], [0x034f, "the combining grapheme joiner"], [0x115f, "the Hangul choseong filler"],
    [0x3164, "the Hangul filler"], [0x17b4, "a Khmer inherent vowel"], [0x200b, "the zero-width space"],
    [0x2060, "the word joiner"], [0x2064, "the invisible plus"], [0x206a, "the first deprecated format character"],
    [0x206f, "the last deprecated format character"], [0xfff9, "the interlinear annotation anchor"],
    [0xfffb, "the interlinear annotation terminator"], [0x1bca0, "a shorthand format control"],
    [0x1d173, "the first musical format character"], [0x1d17a, "the last musical format character"],
    [0xe0001, "the language tag"], [0xe007f, "the cancel tag"],
  ];
  for (const [cp, what] of forbidden) {
    const tag = cp.toString(16).toUpperCase().padStart(4, "0"), idTag = tag.toLowerCase();
    payloadCase(`forbidden-u${idTag}`, "Appendix B", `A value containing U+${tag}, ${what}.`, { fields: [["Name", `a${String.fromCodePoint(cp)}b`]] });
  }
  payloadCase("forbidden-in-name", "Appendix B", "A field name containing U+202E, a right-to-left override.", { fields: [["Am‮tnuo", "1"]] });
  payloadCase("forbidden-invisible-in-name", "Appendix B", "Two fields named Amount, the second followed by U+200B, a zero-width space: the names differ but would display the same.", { fields: [["Amount", "1"], ["Amount\u200b", "2"]] });
}

// ===== order of checks (8.2) ===============================================================
add("order-malformed-before-dns", "8.2", "A malformed envelope with a DNS name that would fail. A verifier must not query DNS for it.",
  build({ keyId: "K2026" }).text, { dns: { "K2026._dkds.northwind.example": { result: "failure" } }, expect: { outcome: "malformed" }, queries: [] });
add("order-future-before-dns", "8.2", "Issued too far in the future, with no key published. The clock is checked before DNS.",
  build({ issuedAt: NOW + 3600 }).text, { dns: { [DEFAULT_NAME]: { result: "nxdomain" } }, expect: { outcome: "malformed" }, queries: [] });
add("order-revoked-before-algorithm", "8.2", "The key is revoked and names an unknown algorithm. Revocation is checked first.",
  base.text, { dns: rec("v=DKDS1; k=ed448; p="), expect: { outcome: "key-revoked" }, queries: reaches() });
add("order-signature-before-payload", "8.2", "A payload that is not DEFLATE, signed with the wrong key. The signature is checked before the payload is read.",
  build({ payload: Uint8Array.of(0xff, 0xff), key: K2 }).text, { expect: { outcome: "invalid-signature" }, queries: reaches() });

// ---- output ---------------------------------------------------------------------------------
const ids = new Set();
for (const v of vectors) { if (ids.has(v.id)) throw new Error("duplicate id " + v.id); ids.add(v.id); }

const out = {
  $schema: "./vectors.schema.json",
  specification: "DKDS version 1",
  generator: "spec/tools/vectors.mjs",
  keys: {
    k1: { seed: hex(K1.seed), public: b64(K1.pub), note: "The key of Appendix C. Published test key: never use it for anything else." },
    k2: { seed: hex(K2.seed), public: b64(K2.pub), note: "A second key, for wrong-key vectors." },
  },
  vectors,
};
mkdirSync(new URL("../vectors/", import.meta.url), { recursive: true });
writeFileSync(new URL("../vectors/vectors.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
const count = {};
for (const v of vectors) count[v.expected.outcome] = (count[v.expected.outcome] ?? 0) + 1;

// coverage.md: every section of the specification with the vectors that test it
const bySection = new Map();
for (const v of vectors) for (const sec of v.section.split(",").map((x) => x.trim())) {
  if (!bySection.has(sec)) bySection.set(sec, []);
  bySection.get(sec).push(v);
}
const order = (a) => a.replace(/\d+/g, (n) => n.padStart(3, "0"));
const sections = [...bySection.keys()].sort((a, b) => order(a).localeCompare(order(b)));
const lines = [
  "# Coverage",
  "",
  "Generated by `tools/vectors.mjs`. Do not edit by hand.",
  "",
  `${vectors.length} vectors. Outcomes: ` + Object.entries(count).map(([k, n]) => `\`${k}\` ${n}`).join(", ") + ".",
  "",
  "| Section | Vectors |",
  "|---|---|",
  ...sections.map((sec) => `| ${sec} | ${bySection.get(sec).map((v) => `\`${v.id}\``).join(", ")} |`),
  "",
];
writeFileSync(new URL("../vectors/coverage.md", import.meta.url), lines.join("\n"));
console.log(`${vectors.length} vectors`, count);
