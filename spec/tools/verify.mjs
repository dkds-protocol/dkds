// Reference verifier for DKDS version 1.
//
// Implements specification.md section 8 literally, one step at a time, so it
// can be read side by side with the specification. It is written for
// clarity, not speed, and is the oracle the test vectors are checked against.
//
//   import { verifyStamp } from "./verify.mjs";
//   const result = await verifyStamp(text, { now, resolve });
//
// `now` is the verifier's clock in Unix seconds. `resolve(name)` performs the
// DNS lookup and returns one of:
//   { result: "answer", txt: [[string, ...], ...], dnssec: boolean }
//   { result: "nxdomain" }            the name does not exist
//   { result: "failure" }             timeout, server failure, DNSSEC failure,
//                                     disagreeing resolvers (spec 9.2)
// CNAMEs are followed by the resolver, as in any DNS lookup.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { inflateRawSync, constants } from "node:zlib";

const Point = ed25519.Point;
const L = Point.Fn.ORDER;

// ---- outcomes (8.1) ---------------------------------------------------------
export const OUTCOMES = [
  "valid", "malformed", "unsupported", "key-not-found",
  "key-revoked", "invalid-signature", "unavailable",
];

class Outcome extends Error {
  constructor(outcome, reason) { super(reason); this.outcome = outcome; }
}
const fail = (outcome, reason) => { throw new Outcome(outcome, reason); };

// ---- Base45, strict (3.2) -----------------------------------------------------
const B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
function base45Decode(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 3) {
    const group = s.slice(i, i + 3);
    if (group.length === 1) fail("malformed", "3.2: final group of one character");
    const v = [...group].map((c) => B45.indexOf(c));
    if (v.includes(-1)) fail("malformed", "3.2: character outside the Base45 alphabet");
    if (group.length === 3) {
      const n = v[0] + v[1] * 45 + v[2] * 2025;
      if (n > 0xffff) fail("malformed", "3.2: group value above 65535");
      out.push(n >> 8, n & 0xff);
    } else {
      const n = v[0] + v[1] * 45;
      if (n > 0xff) fail("malformed", "3.2: final pair value above 255");
      out.push(n);
    }
  }
  return Uint8Array.from(out);
}

// ---- Punycode, RFC 3492 (4.2) -------------------------------------------------
const PC = { base: 36, tmin: 1, tmax: 26, skew: 38, damp: 700, initialBias: 72, initialN: 128 };
function adapt(delta, numPoints, first) {
  delta = first ? Math.floor(delta / PC.damp) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((PC.base - PC.tmin) * PC.tmax) >> 1) { delta = Math.floor(delta / (PC.base - PC.tmin)); k += PC.base; }
  return k + Math.floor(((PC.base - PC.tmin + 1) * delta) / (delta + PC.skew));
}
const digitOf = (c) => (c >= 48 && c <= 57 ? c - 22 : c >= 97 && c <= 122 ? c - 97 : -1);
const digitChar = (d) => String.fromCharCode(d < 26 ? d + 97 : d + 22);
export function punycodeDecode(input) {
  const out = [];
  const delim = input.lastIndexOf("-");
  if (delim > 0) for (const ch of input.slice(0, delim)) out.push(ch.codePointAt(0));
  let n = PC.initialN, bias = PC.initialBias, i = 0;
  for (let pos = delim > 0 ? delim + 1 : 0; pos < input.length;) {
    const oldi = i;
    for (let w = 1, k = PC.base; ; k += PC.base) {
      if (pos >= input.length) return null;
      const digit = digitOf(input.charCodeAt(pos++));
      if (digit < 0) return null;
      i += digit * w;
      if (i > 0x7fffffff) return null;
      const t = k <= bias ? PC.tmin : k >= bias + PC.tmax ? PC.tmax : k - bias;
      if (digit < t) break;
      w *= PC.base - t;
      if (w > 0x7fffffff) return null;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    n += Math.floor(i / (out.length + 1));
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
    i %= out.length + 1;
    out.splice(i++, 0, n);
  }
  return out;
}
export function punycodeEncode(cps) {
  let out = "";
  for (const c of cps) if (c < 128) out += String.fromCharCode(c);
  const b = out.length;
  let h = b, n = PC.initialN, delta = 0, bias = PC.initialBias;
  if (b > 0) out += "-";
  while (h < cps.length) {
    const m = Math.min(...cps.filter((c) => c >= n));
    delta += (m - n) * (h + 1); n = m;
    for (const c of cps) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = PC.base; ; k += PC.base) {
          const t = k <= bias ? PC.tmin : k >= bias + PC.tmax ? PC.tmax : k - bias;
          if (q < t) break;
          out += digitChar(t + ((q - t) % (PC.base - t)));
          q = Math.floor((q - t) / (PC.base - t));
        }
        out += digitChar(q);
        bias = adapt(delta, h + 1, h === b); delta = 0; h++;
      }
    }
    delta++; n++;
  }
  return out;
}

// ---- forbidden code points (Appendix B) ---------------------------------------
export function isForbidden(cp) {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0x061c || cp === 0x200e || cp === 0x200f ||
    (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0x2028 || cp === 0x2029 || cp === 0xfeff ||
    (cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe ||
    // invisible characters that no script requires
    cp === 0x00ad || cp === 0x034f || cp === 0x115f || cp === 0x1160 || cp === 0x3164 || cp === 0xffa0 ||
    cp === 0x17b4 || cp === 0x17b5 || cp === 0x200b ||
    (cp >= 0x2060 && cp <= 0x2064) || (cp >= 0x206a && cp <= 0x206f) || (cp >= 0xfff9 && cp <= 0xfffb) ||
    (cp >= 0x1bca0 && cp <= 0x1bca3) || (cp >= 0x1d173 && cp <= 0x1d17a) || (cp >= 0xe0000 && cp <= 0xe007f);
}

// ---- domain and key ID (4.2, 4.3) ------------------------------------------------
const LDH = /^[a-z0-9-]{1,63}$/;
function checkDomain(domain) {
  const labels = domain.split(".");
  if (labels.length < 2) fail("malformed", "4.2: fewer than two labels");
  const unicode = [];
  for (const label of labels) {
    if (!LDH.test(label)) fail("malformed", "4.2: label is not 1-63 of [a-z0-9-]");
    if (label.startsWith("-") || label.endsWith("-")) fail("malformed", "4.2: label begins or ends with a hyphen");
    if (label.slice(2, 4) === "--" && !label.startsWith("xn--")) fail("malformed", "4.2: reserved label not starting with xn--");
    if (!label.startsWith("xn--")) { unicode.push(label); continue; }
    const tail = label.slice(4);
    const cps = punycodeDecode(tail);
    if (!cps) fail("malformed", "4.2: invalid Punycode");
    if (cps.some(isForbidden)) fail("malformed", "4.2: xn-- label decodes to a forbidden code point");
    if (cps.some((cp) => cp === 0x3002 || cp === 0xff0e || cp === 0xff61)) fail("malformed", "4.2: xn-- label decodes to a full stop other than U+002E");
    if (punycodeEncode(cps) !== tail) fail("malformed", "4.2: Punycode does not round-trip");
    unicode.push(String.fromCodePoint(...cps));
  }
  return unicode.join(".");
}

// ---- key record (7.2, 7.3) -------------------------------------------------------
const TAG_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const TAG_VALUE = /^[\x21-\x3a\x3c-\x7e]*$/;
function parseRecord(text) {
  const parts = text.split(";");
  if (parts.length > 1 && /^[ \t]*$/.test(parts[parts.length - 1])) parts.pop();   // optional final ";"
  const tags = new Map();
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) return null;
    const name = part.slice(0, eq).replace(/^[ \t]+|[ \t]+$/g, "");
    const value = part.slice(eq + 1).replace(/^[ \t]+|[ \t]+$/g, "");
    if (!TAG_NAME.test(name) || !TAG_VALUE.test(value)) return null;
    if (tags.has(name)) return null;                                               // at most once
    tags.set(name, value);
  }
  return tags;
}
function firstTagIsV1(text) {
  return /^[ \t]*v[ \t]*=[ \t]*DKDS1[ \t]*(;|$)/.test(text);
}
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// ---- Ed25519 (6.3) -----------------------------------------------------------------
const leInt = (b) => b.reduceRight((acc, x) => (acc << 8n) | BigInt(x), 0n);
function decodeCanonical(bytes) {
  let P;
  try { P = Point.fromBytes(bytes, true); } catch { return null; }                // lenient decode ...
  const again = P.toBytes();
  for (let i = 0; i < 32; i++) if (again[i] !== bytes[i]) return null;           // ... then require a round trip
  return P;
}
export function ed25519Verify(publicKey, message, signature) {
  if (signature.length !== 64) return "6.3 check 1: signature is not 64 bytes";
  const Rb = signature.subarray(0, 32), Sb = signature.subarray(32);
  const S = leInt(Sb);
  if (S >= L) return "6.3 check 2: S >= L";
  const A = decodeCanonical(publicKey), R = decodeCanonical(Rb);
  if (!A || !R) return "6.3 check 3: non-canonical or invalid point";
  if (A.isSmallOrder() || R.isSmallOrder()) return "6.3 check 4: point of small order";
  const k = leInt(sha512(new Uint8Array([...Rb, ...publicKey, ...message]))) % L;
  const check = Point.BASE.multiplyUnsafe(S).subtract(A.multiplyUnsafe(k)).toBytes();
  for (let i = 0; i < 32; i++) if (check[i] !== Rb[i]) return "6.3 check 5: [S]B - [k]A != R";
  return null;
}

// ---- payload (5) ---------------------------------------------------------------------
const MAX_INFLATED = 16384;
function decodePayload(payload) {
  let flat;
  try {
    // maxOutputLength stops inflation at the limit (5.2); finishFlush makes a
    // truncated stream an error instead of a partial result.
    flat = inflateRawSync(payload, { maxOutputLength: MAX_INFLATED + 1, finishFlush: constants.Z_FINISH, info: true });
  } catch { fail("malformed", "5.2: invalid DEFLATE stream, or longer than 16384 bytes"); }
  if (flat.engine.bytesWritten !== payload.length) fail("malformed", "5.2: data after the end of the DEFLATE stream");
  const data = flat.buffer;
  if (data.length > MAX_INFLATED) fail("malformed", "5.2: decompressed size above 16384 bytes");

  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let o = 0;
  const take = (n) => {
    if (o + n > data.length) fail("malformed", "5.2: field list ends before its declared length");
    const b = data.subarray(o, o + n); o += n; return b;
  };
  const text = (b) => {
    let s;
    try { s = utf8.decode(b); } catch { fail("malformed", "5.2: invalid UTF-8"); }
    for (const ch of s) if (isForbidden(ch.codePointAt(0))) fail("malformed", "5.2: forbidden code point");
    return s;
  };
  const count = take(1)[0];
  if (count < 1) fail("malformed", "5.1: zero fields");
  const fields = [], seen = new Set();
  for (let i = 0; i < count; i++) {
    const nameLen = take(1)[0];
    if (nameLen < 1) fail("malformed", "5.1: empty name");
    const nameBytes = take(nameLen);
    const key = Buffer.from(nameBytes).toString("hex");
    if (seen.has(key)) fail("malformed", "5.2: duplicate name");
    seen.add(key);
    const name = text(nameBytes);
    const valueLen = (take(1)[0] << 8) | take(1)[0];
    const value = text(take(valueLen));
    fields.push([name, value]);
  }
  if (o !== data.length) fail("malformed", "5.2: data after the end of the field list");
  return fields;
}

// ---- the procedure (8.2) ---------------------------------------------------------------
export async function verifyStamp(text, { now, resolve }) {
  try {
    return { outcome: "valid", ...(await run(text, now, resolve)) };
  } catch (e) {
    if (e instanceof Outcome) return { outcome: e.outcome, reason: e.message };
    throw e;
  }
}

async function run(text, now, resolve) {
  // step 1: text form (3.1, 3.2)
  if (typeof text !== "string" || !text.startsWith("DKDS:")) fail("malformed", "3.1: missing DKDS: prefix");
  if (text.length > 1637) fail("malformed", "3.1: text longer than 1637 characters");
  const env = base45Decode(text.slice(5));

  // steps 2 and 3: version (4.4)
  if (env.length < 1 || env[0] === 0x00 || env[0] === 0xff) fail("malformed", "4.4: empty envelope or reserved version");
  if (env[0] !== 0x01) fail("unsupported", "4.4: version " + env[0]);

  // step 4: envelope (4)
  if (env.length > 1088) fail("malformed", "4.1: envelope longer than 1088 bytes");
  let o = 1;
  const take = (n) => {
    if (o + n > env.length) fail("malformed", "4.1: field extends past the envelope");
    const b = env.subarray(o, o + n); o += n; return b;
  };
  const domainLen = take(1)[0];
  if (domainLen < 1) fail("malformed", "4.2: empty domain");
  const domain = Buffer.from(take(domainLen)).toString("latin1");
  const keyidLen = take(1)[0];
  if (keyidLen < 1 || keyidLen > 16) fail("malformed", "4.3: key ID length");
  const keyId = Buffer.from(take(keyidLen)).toString("latin1");
  if (!/^[a-z0-9]{1,16}$/.test(keyId)) fail("malformed", "4.3: key ID characters");
  const issuedAt = Buffer.from(take(4)).readUInt32BE(0);
  const payloadLen = Buffer.from(take(2)).readUInt16BE(0);
  if (payloadLen < 1) fail("malformed", "4.1: empty payload");
  const payload = take(payloadLen);
  const signedPart = env.subarray(0, o);
  const signature = env.subarray(o);
  if (signature.length < 1) fail("malformed", "4.1: no signature bytes");
  const domainUnicode = checkDomain(domain);
  const lookupName = `${keyId}._dkds.${domain}`;
  if (lookupName.length > 253) fail("malformed", "4.2: lookup name longer than 253 characters");

  // step 5: clock (8.2)
  if (issuedAt > now + 600) fail("malformed", "8.2 step 5: issued more than 600 seconds in the future");

  // step 6: DNS (7.1, 7.3)
  const answer = await resolve(lookupName);
  if (answer.result === "failure") fail("unavailable", "8.2 step 6: no DNS answer");
  if (answer.result === "nxdomain") fail("key-not-found", "8.2 step 6: name does not exist");
  const candidates = answer.txt.map((strings) => strings.join("")).filter(firstTagIsV1);
  if (candidates.length !== 1) fail("key-not-found", `7.3: ${candidates.length} records with v=DKDS1`);
  const tags = parseRecord(candidates[0]);
  if (!tags || !tags.has("k") || !tags.has("p")) fail("key-not-found", "7.2: record does not parse");

  // step 7: revocation (7.4)
  if (tags.get("p") === "") fail("key-revoked", "7.4: empty p tag");

  // step 8: algorithm (6.2)
  if (tags.get("k") !== "ed25519") fail("unsupported", "8.2 step 8: algorithm " + tags.get("k"));

  // step 9: key encoding (7.2)
  const p = tags.get("p");
  if (!B64.test(p)) fail("key-not-found", "7.2: p is not padded Base64");
  const publicKey = new Uint8Array(Buffer.from(p, "base64"));
  if (publicKey.length !== 32) fail("key-not-found", "7.2: p is not 32 bytes");
  if (Buffer.from(publicKey).toString("base64") !== p) fail("key-not-found", "7.2: p is not the canonical Base64 encoding");

  // step 10: signature (6)
  const message = new Uint8Array([...Buffer.from("DKDS", "ascii"), ...signedPart]);
  const bad = ed25519Verify(publicKey, message, signature);
  if (bad) fail("invalid-signature", bad);

  // step 11: payload, only now (5)
  const fields = decodePayload(payload);

  // step 12
  return { domain, domainUnicode, keyId, issuedAt, dnssec: answer.dnssec === true, fields };
}
