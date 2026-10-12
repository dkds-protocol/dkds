/**
 * Key records (specification 7.2 to 7.4).
 *
 * ```
 * record = tag *( ";" tag ) [ ";" ] *WSP
 * tag    = *WSP name *WSP "=" *WSP value *WSP
 * ```
 */

import { base64Encode } from "../bytes.ts";
import { fail } from "../errors.ts";

/** The value of the `v` tag for records of this version. */
export const RECORD_VERSION = "DKDS1";

/** A parsed key record. */
export interface KeyRecord {
  /** The record as published, with its character strings joined. */
  readonly text: string;
  /** The algorithm (`k` tag). */
  readonly k: string;
  /** The public key (`p` tag), unparsed. Empty for a revoked key. */
  readonly p: string;
  /** Every tag of the record, including unknown tags, in order. */
  readonly tags: ReadonlyMap<string, string>;
}

const TAG_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const TAG_VALUE = /^[\x21-\x3a\x3c-\x7e]*$/;
const WSP_ONLY = /^[ \t]*$/;
const FIRST_TAG_V1 = new RegExp(`^[ \\t]*v[ \\t]*=[ \\t]*${RECORD_VERSION}[ \\t]*(;|$)`);
const trimWsp = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, "");

/** Returns true when the first tag of a record is `v=DKDS1` (7.3). */
export function isVersion1Record(text: string): boolean {
  return FIRST_TAG_V1.test(text);
}

/**
 * Parses a record according to 7.2. Returns `null` when it does not match the grammar, when a tag
 * appears twice, when `v=DKDS1` is not the first tag, or when `k` or `p` is missing.
 */
export function parseKeyRecord(text: string): KeyRecord | null {
  if (!isVersion1Record(text)) return null;
  const parts = text.split(";");
  if (parts.length > 1 && WSP_ONLY.test(parts[parts.length - 1]!)) parts.pop();
  const tags = new Map<string, string>();
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) return null;
    const name = trimWsp(part.slice(0, eq));
    const value = trimWsp(part.slice(eq + 1));
    if (!TAG_NAME.test(name) || !TAG_VALUE.test(value) || tags.has(name)) return null;
    tags.set(name, value);
  }
  const k = tags.get("k");
  const p = tags.get("p");
  if (k === undefined || p === undefined) return null;
  return { text, k, p, tags };
}

/**
 * Selects the key record from the TXT records at a lookup name (7.3). Each record is given as its list
 * of character strings, which are joined without separators. Returns `null` unless exactly one record
 * begins with `v=DKDS1` and that record parses.
 */
export function selectKeyRecord(txt: readonly (readonly string[])[]): KeyRecord | null {
  const candidates = txt.map((strings) => strings.join("")).filter(isVersion1Record);
  return candidates.length === 1 ? parseKeyRecord(candidates[0]!) : null;
}

/**
 * Formats the key record for an Ed25519 public key, or the revocation record when `publicKey` is
 * `null` (7.4). Throws `key-invalid` when the key is not 32 bytes.
 */
export function formatKeyRecord(publicKey: Uint8Array | null): string {
  if (publicKey !== null && (!(publicKey instanceof Uint8Array) || publicKey.length !== 32)) {
    fail("key-invalid", "An Ed25519 public key is 32 bytes.");
  }
  return `v=${RECORD_VERSION}; k=ed25519; p=${publicKey === null ? "" : base64Encode(publicKey)}`;
}
