/**
 * Inspection of a stamp's header without verification and without any DNS query.
 */

import { decodeText } from "./carrier/text.ts";
import { envelopeVersion, isReservedVersion, parseEnvelope } from "./envelope.ts";
import { DkdsError, fail } from "./errors.ts";
import { VERSION } from "./limits.ts";
import type { Outcome } from "./verify.ts";

/** The result of {@link inspectStamp}. */
export type Inspection =
  | {
      readonly parsed: true;
      readonly version: number;
      readonly domain: string;
      readonly domainUnicode: string;
      readonly keyId: string;
      readonly issuedAt: number;
      readonly lookupName: string;
      /** Sizes in characters (text) and bytes (the others). */
      readonly sizes: { readonly text: number; readonly envelope: number; readonly payload: number; readonly signature: number };
    }
  | {
      readonly parsed: false;
      /** The outcome verification would report. */
      readonly outcome: Outcome;
      /** The step of 8.2 that determines it, 1 to 4. */
      readonly step: number;
      readonly reason: string;
    };

/**
 * Performs steps 1 to 4 of 8.2 and returns the header of the stamp. The result says nothing about the
 * validity of the stamp, and it never contains the fields: fields are available only from
 * {@link verifyStamp} with the outcome `valid`.
 */
export function inspectStamp(text: string): Inspection {
  if (typeof text !== "string") fail("invalid-argument", "The stamp must be given as a string.");
  const rejected = (outcome: Outcome, step: number, reason: string): Inspection => ({ parsed: false, outcome, step, reason });
  let bytes: Uint8Array;
  try {
    bytes = decodeText(text);
  } catch (e) {
    if (e instanceof DkdsError) return rejected("malformed", 1, e.message);
    throw e;
  }
  const version = envelopeVersion(bytes);
  if (version === undefined || isReservedVersion(version)) return rejected("malformed", 2, "The envelope is empty or has a reserved version (4.4).");
  if (version !== VERSION) return rejected("unsupported", 3, `The envelope has version ${version} (4.4).`);
  try {
    const e = parseEnvelope(bytes);
    return {
      parsed: true,
      version,
      domain: e.domain,
      domainUnicode: e.domainUnicode,
      keyId: e.keyId,
      issuedAt: e.issuedAt,
      lookupName: e.lookupName,
      sizes: { text: text.length, envelope: bytes.length, payload: e.payload.length, signature: e.signature.length },
    };
  } catch (e) {
    if (e instanceof DkdsError) return rejected("malformed", 4, e.message);
    throw e;
  }
}
