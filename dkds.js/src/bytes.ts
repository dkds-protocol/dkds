/**
 * Byte-string utilities shared by the layers. They use only APIs available in every supported
 * runtime.
 */

import { fail } from "./errors.ts";

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Encodes a string as UTF-8. Lone surrogates are not valid input and must be rejected beforehand. */
export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

/**
 * Decodes UTF-8 strictly (RFC 3629): overlong forms, surrogates, code points above U+10FFFF and
 * truncated sequences are rejected. A leading byte order mark is kept as U+FEFF.
 */
export function utf8Decode(bytes: Uint8Array): string {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    return fail("utf8-invalid", "Invalid UTF-8 (RFC 3629).");
  }
}

/** Returns the bytes of an ASCII string. Each character must be below U+0080. */
export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

/** Interprets each byte as one character (ISO 8859-1). Used for byte strings that must be ASCII. */
export function latin1String(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** Concatenates byte strings. */
export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const p of parts) length += p.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Compares two byte strings for equality. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Returns true when a string contains no lone surrogate, so that it has a UTF-8 encoding. */
export function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_PADDED = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Encodes bytes as Base64 with padding (RFC 4648, section 4). */
export function base64Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(bytes.length - i, 3) + 1;
    for (let j = 0; j < 4; j++) out += j < chars ? B64[(n >> (18 - 6 * j)) & 63] : "=";
  }
  return out;
}

/**
 * Decodes canonical, padded Base64 (RFC 4648, section 4): the alphabet without URL-safe characters,
 * with padding, without whitespace, and with zero bits in the unused final positions. Returns `null`
 * for any other input.
 */
export function base64DecodeCanonical(text: string): Uint8Array | null {
  if (!B64_PADDED.test(text)) return null;
  const body = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((body.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const ch of body) {
    acc = ((acc << 6) | B64.indexOf(ch)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  if ((acc & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

/** Encodes bytes as Base64url without padding (RFC 4648, section 5). */
export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
