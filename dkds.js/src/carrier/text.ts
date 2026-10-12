/**
 * The text form of a stamp (specification 3.1): `"DKDS:" || Base45(envelope)`.
 */

import { fail } from "../errors.ts";
import { LIMITS, TEXT_PREFIX } from "../limits.ts";
import { base45Decode, base45Encode } from "./base45.ts";

/** Returns the text form of an envelope. */
export function encodeText(envelope: Uint8Array): string {
  return TEXT_PREFIX + base45Encode(envelope);
}

/**
 * Returns the envelope contained in a text form. Throws `text-invalid` when the prefix is missing or
 * the text is too long, and `base45-invalid` when the encoding is not valid (3.1, 3.2).
 */
export function decodeText(text: string): Uint8Array {
  if (!text.startsWith(TEXT_PREFIX)) fail("text-invalid", `The text does not begin with "${TEXT_PREFIX}" (3.1).`);
  if (text.length > LIMITS.textLength) {
    fail("text-invalid", `The text has ${text.length} characters; the maximum is ${LIMITS.textLength} (3.1).`);
  }
  return base45Decode(text.slice(TEXT_PREFIX.length));
}
