/**
 * Forbidden code points (specification, Appendix B).
 */

import { fail } from "./errors.ts";

/** Returns true when a code point is forbidden in field names, field values and domain labels. */
export function isForbidden(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0x061c ||
    cp === 0x200e ||
    cp === 0x200f ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0xfeff ||
    (cp >= 0xfdd0 && cp <= 0xfdef) ||
    (cp & 0xfffe) === 0xfffe ||
    isInvisible(cp)
  );
}

/** Characters that display as nothing or as blank space and that no script requires (Appendix B). */
function isInvisible(cp: number): boolean {
  return (
    cp === 0x00ad ||
    cp === 0x034f ||
    cp === 0x115f ||
    cp === 0x1160 ||
    cp === 0x3164 ||
    cp === 0xffa0 ||
    cp === 0x17b4 ||
    cp === 0x17b5 ||
    cp === 0x200b ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    (cp >= 0x206a && cp <= 0x206f) ||
    (cp >= 0xfff9 && cp <= 0xfffb) ||
    (cp >= 0x1bca0 && cp <= 0x1bca3) ||
    (cp >= 0x1d173 && cp <= 0x1d17a) ||
    (cp >= 0xe0000 && cp <= 0xe007f)
  );
}

/** Full stops other than U+002E, forbidden in the decoded labels of a domain (4.2). */
export const FULL_STOPS: readonly number[] = [0x3002, 0xff0e, 0xff61];

/** Returns the first forbidden code point in a string, or `undefined` when there is none. */
export function findForbidden(text: string): number | undefined {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isForbidden(cp)) return cp;
  }
  return undefined;
}

/** Formats a code point in the notation U+XXXX. */
export function formatCodePoint(cp: number): string {
  return "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
}

/** Throws `forbidden-code-point` when a string contains a forbidden code point. */
export function assertNoForbidden(text: string, what: string): void {
  const cp = findForbidden(text);
  if (cp !== undefined) {
    fail("forbidden-code-point", `${what} contains the forbidden code point ${formatCodePoint(cp)} (Appendix B).`);
  }
}
