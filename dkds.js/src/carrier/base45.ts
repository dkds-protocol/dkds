/**
 * Base45 (RFC 9285) with the strict decoding rules of specification 3.2.
 */

import { fail } from "../errors.ts";

/** The Base45 alphabet, which is also the QR alphanumeric character set. */
export const BASE45_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

const VALUE = new Map<string, number>(Array.from(BASE45_ALPHABET, (ch, i) => [ch, i]));

/** Encodes bytes as Base45. */
export function base45Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    let n = (bytes[i]! << 8) | bytes[i + 1]!;
    for (let j = 0; j < 3; j++) {
      out += BASE45_ALPHABET[n % 45];
      n = Math.floor(n / 45);
    }
  }
  if (bytes.length % 2 === 1) {
    const n = bytes[bytes.length - 1]!;
    out += BASE45_ALPHABET[n % 45]! + BASE45_ALPHABET[Math.floor(n / 45)]!;
  }
  return out;
}

/**
 * Decodes Base45. Throws `base45-invalid` for a character outside the alphabet, a group of three
 * characters above 65,535, a final group of one character, or a final group of two characters above
 * 255 (3.2). Under these rules each byte string has exactly one encoding.
 */
export function base45Decode(text: string): Uint8Array {
  if (text.length % 3 === 1) fail("base45-invalid", "Base45 text ends with a group of one character (3.2).");
  const out = new Uint8Array(Math.floor(text.length / 3) * 2 + (text.length % 3 === 2 ? 1 : 0));
  let o = 0;
  for (let i = 0; i < text.length; i += 3) {
    const group = text.slice(i, i + 3);
    let n = 0;
    for (let j = group.length - 1; j >= 0; j--) {
      const v = VALUE.get(group[j]!);
      if (v === undefined) fail("base45-invalid", "Base45 text contains a character outside the alphabet (3.2).");
      n = n * 45 + v;
    }
    if (group.length === 3) {
      if (n > 0xffff) fail("base45-invalid", "A Base45 group of three characters exceeds 65535 (3.2).");
      out[o++] = n >> 8;
      out[o++] = n & 0xff;
    } else {
      if (n > 0xff) fail("base45-invalid", "The final Base45 group of two characters exceeds 255 (3.2).");
      out[o++] = n;
    }
  }
  return out;
}
