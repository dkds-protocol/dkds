/**
 * Domain names, key IDs and lookup names (specification 4.2 and 4.3).
 */

import { FULL_STOPS, findForbidden, formatCodePoint } from "./codepoints.ts";
import { fail } from "./errors.ts";
import { LIMITS } from "./limits.ts";
import { punycodeDecode, punycodeEncode } from "./punycode.ts";

const LABEL = /^[a-z0-9-]{1,63}$/;
const KEY_ID = /^[a-z0-9]{1,16}$/;
const ACE_PREFIX = "xn--";

/**
 * Checks a domain against 4.2 and returns its Unicode form, in which every `xn--` label is replaced by
 * its decoded string. Throws `domain-invalid` when a rule is not met.
 */
export function parseDomain(domain: string): string {
  const labels = domain.split(".");
  if (labels.length < 2) fail("domain-invalid", "The domain has fewer than two labels (4.2).");
  return labels.map(parseLabel).join(".");
}

function parseLabel(label: string): string {
  if (!LABEL.test(label)) {
    fail("domain-invalid", `A label of the domain is not 1 to 63 characters from a-z, 0-9 and "-" (4.2).`);
  }
  if (label.startsWith("-") || label.endsWith("-")) {
    fail("domain-invalid", `The label "${label}" begins or ends with "-" (4.2).`);
  }
  if (label.slice(2, 4) === "--" && !label.startsWith(ACE_PREFIX)) {
    fail("domain-invalid", `The label "${label}" has "--" in positions 3 and 4 without beginning with "xn--" (4.2).`);
  }
  if (!label.startsWith(ACE_PREFIX)) return label;

  const encoded = label.slice(ACE_PREFIX.length);
  const codePoints = punycodeDecode(encoded);
  if (codePoints === null) fail("domain-invalid", `The label "${label}" is not valid Punycode (4.2).`);
  const decoded = String.fromCodePoint(...codePoints);
  const forbidden = findForbidden(decoded);
  if (forbidden !== undefined) {
    fail("domain-invalid", `The label "${label}" decodes to the forbidden code point ${formatCodePoint(forbidden)} (4.2).`);
  }
  const stop = codePoints.find((cp) => FULL_STOPS.includes(cp));
  if (stop !== undefined) {
    fail("domain-invalid", `The label "${label}" decodes to ${formatCodePoint(stop)}, which displays like "." (4.2).`);
  }
  if (punycodeEncode(codePoints) !== encoded) {
    fail("domain-invalid", `The label "${label}" is not the Punycode encoding of its decoded form (4.2).`);
  }
  return decoded;
}

/**
 * Converts a domain given in ASCII or Unicode form to the ASCII form required by 4.2, and checks it.
 * Letters are converted to lowercase and Unicode labels are normalised to NFC and encoded with
 * Punycode. No IDNA2008 mapping or validity check is applied (4.2). Throws `domain-invalid`.
 */
export function toAsciiDomain(input: string): string {
  if (typeof input !== "string" || input.length === 0) fail("domain-invalid", "The domain is empty.");
  const ascii = input
    .normalize("NFC")
    .toLowerCase()
    .split(".")
    .map((label) => (/^[\x00-\x7f]*$/.test(label) ? label : ACE_PREFIX + punycodeEncode(codePointsOf(label))))
    .join(".");
  parseDomain(ascii);
  return ascii;
}

function codePointsOf(text: string): number[] {
  return Array.from(text, (ch) => ch.codePointAt(0)!);
}

/** Checks a key ID against 4.3. Throws `key-id-invalid`. */
export function checkKeyId(keyId: string): void {
  if (typeof keyId !== "string" || !KEY_ID.test(keyId)) {
    fail("key-id-invalid", "The key ID is not 1 to 16 characters from a-z and 0-9 (4.3).");
  }
}

/**
 * Returns the lookup name `<key_id>._dkds.<domain>` (4.2). Throws `lookup-name-too-long` when it exceeds
 * 253 characters.
 */
export function lookupName(keyId: string, domain: string): string {
  const name = `${keyId}._dkds.${domain}`;
  if (name.length > LIMITS.lookupNameLength) {
    fail("lookup-name-too-long", `The lookup name has ${name.length} characters; the maximum is ${LIMITS.lookupNameLength} (4.2).`);
  }
  return name;
}
