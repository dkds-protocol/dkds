/**
 * Verification of a stamp (specification section 8).
 */

import { decodeText } from "./carrier/text.ts";
import { selectKeyRecord, type KeyRecord } from "./discovery/record.ts";
import { defaultResolver } from "./discovery/doh.ts";
import { safeResolve, type Resolver } from "./discovery/resolver.ts";
import { envelopeVersion, isReservedVersion, parseEnvelope, signedMessage, type Envelope } from "./envelope.ts";
import { DkdsError, fail } from "./errors.ts";
import { LIMITS, VERSION } from "./limits.ts";
import { decodePayload, type Field } from "./payload/fields.ts";
import { ALGORITHMS } from "./signature/algorithms.ts";
import { domainWarnings, similarDomains, type KeyStore, type Warning } from "./warnings.ts";

/** The outcomes of verification (8.1). */
export const OUTCOMES = ["valid", "malformed", "unsupported", "key-not-found", "key-revoked", "invalid-signature", "unavailable"] as const;

/** An outcome of verification (8.1). */
export type Outcome = (typeof OUTCOMES)[number];

/** Options of {@link verifyStamp}. */
export interface VerifyOptions {
  /** The verifier's clock, in Unix seconds. Default: the system clock. */
  readonly now?: number;
  /** The DNS lookup. Default: {@link defaultResolver}. */
  readonly resolve?: Resolver;
  /** Remembers key records and domains for the warnings of 9.2 and 9.3. Default: none. */
  readonly keyStore?: KeyStore;
  /** Cancels the DNS lookup. */
  readonly signal?: AbortSignal;
}

/** The result of {@link verifyStamp}. */
export interface VerifyResult {
  /** The outcome (8.1). */
  readonly outcome: Outcome;
  /** The step of 8.2 that determined the outcome, 1 to 12. */
  readonly step: number;
  /** An explanation of the outcome for developers. Its wording is not stable. */
  readonly reason: string;
  /** The issuer's domain in ASCII form. Present from step 5 on. */
  readonly domain?: string;
  /** The issuer's domain in Unicode form (4.2). Present from step 5 on. */
  readonly domainUnicode?: string;
  /** The key ID. Present from step 5 on. */
  readonly keyId?: string;
  /** The time of signing, in Unix seconds. Present from step 5 on. */
  readonly issuedAt?: number;
  /** Whether the DNS answer was validated with DNSSEC. Present once a DNS answer was obtained. */
  readonly dnssec?: boolean;
  /** The number of resolvers that gave the answer, when the resolver reports it (9.2). */
  readonly resolvers?: number;
  /** Warnings for the reader (9.2, 9.3). They do not affect the outcome. */
  readonly warnings: readonly Warning[];
  /** The fields, in order. Present only when the outcome is `valid` (9.1). */
  readonly fields?: readonly Field[];
}

type Verdict = Omit<VerifyResult, "warnings"> & { readonly record?: KeyRecord; readonly envelope?: Envelope };

/** Turns an error of a layer into the outcome of a step; any other exception is rethrown. */
function rejection(e: unknown, step: number, outcome: Outcome): Verdict {
  if (e instanceof DkdsError) return { outcome, step, reason: e.message };
  throw e;
}

/**
 * Verifies a stamp, given as the text a QR scanner delivers, following 8.2. Every problem with the stamp
 * or the DNS is reported as an outcome. The function throws a {@link DkdsError} with the code
 * `invalid-argument` when it is called incorrectly, and passes on errors thrown by the key store.
 */
export async function verifyStamp(text: string, options: VerifyOptions = {}): Promise<VerifyResult> {
  if (typeof text !== "string") fail("invalid-argument", "The stamp must be given as a string.");
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (typeof now !== "number" || !Number.isFinite(now)) fail("invalid-argument", "now must be a finite number of seconds.");
  if (options.resolve !== undefined && typeof options.resolve !== "function") fail("invalid-argument", "resolve must be a function.");

  const verdict = await procedure(text, now, options.resolve ?? defaultResolver(), options.signal);
  const { record, envelope, ...result } = verdict;
  const warnings = await collectWarnings(verdict, options.keyStore);
  if (options.keyStore && result.outcome === "valid" && envelope && record) {
    await options.keyStore.set(envelope.lookupName, record.text, envelope.domainUnicode);
  }
  return { ...result, warnings };
}

/** Steps 1 to 12 of 8.2. */
async function procedure(text: string, now: number, resolve: Resolver, signal: AbortSignal | undefined): Promise<Verdict> {
  // Step 1: text form (3.1, 3.2).
  let bytes: Uint8Array;
  try {
    bytes = decodeText(text);
  } catch (e) {
    return rejection(e, 1, "malformed");
  }

  // Steps 2 and 3: version (4.4).
  const version = envelopeVersion(bytes);
  if (version === undefined || isReservedVersion(version)) {
    return { outcome: "malformed", step: 2, reason: "The envelope is empty or has a reserved version (4.4)." };
  }
  if (version !== VERSION) return { outcome: "unsupported", step: 3, reason: `The envelope has version ${version} (4.4).` };

  // Step 4: envelope (section 4).
  let envelope: Envelope;
  try {
    envelope = parseEnvelope(bytes);
  } catch (e) {
    return rejection(e, 4, "malformed");
  }

  // Step 5: clock.
  const header = {
    domain: envelope.domain,
    domainUnicode: envelope.domainUnicode,
    keyId: envelope.keyId,
    issuedAt: envelope.issuedAt,
    envelope,
  };
  if (envelope.issuedAt > now + LIMITS.clockToleranceSeconds) {
    return { ...header, outcome: "malformed", step: 5, reason: "issued_at is more than 600 seconds after the verifier's clock (8.2)." };
  }

  // Step 6: key discovery (section 7).
  const answer = await safeResolve(resolve, envelope.lookupName, signal ? { signal } : {});
  if (answer.result === "failure") {
    return { ...header, outcome: "unavailable", step: 6, reason: `No DNS answer was obtained${answer.reason ? `: ${answer.reason}` : "."}` };
  }
  const dns = answer.resolvers === undefined ? {} : { resolvers: answer.resolvers };
  if (answer.result === "nxdomain") {
    return { ...header, ...dns, outcome: "key-not-found", step: 6, reason: `The name ${envelope.lookupName} does not exist (7.1).` };
  }
  const found = { ...header, ...dns, dnssec: answer.dnssec };
  const record = selectKeyRecord(answer.txt);
  if (record === null) {
    return { ...found, outcome: "key-not-found", step: 6, reason: `No usable key record exists at ${envelope.lookupName} (7.3).` };
  }
  const withRecord = { ...found, record };

  // Step 7: revocation (7.4).
  if (record.p === "") return { ...withRecord, outcome: "key-revoked", step: 7, reason: "The key has been revoked (7.4)." };

  // Step 8: algorithm (6.2).
  const algorithm = ALGORITHMS.get(record.k);
  if (algorithm === undefined) {
    return { ...withRecord, outcome: "unsupported", step: 8, reason: `The key uses the algorithm "${record.k}", which is not implemented (6.2).` };
  }

  // Step 9: key encoding (7.2).
  const publicKey = algorithm.decodePublicKey(record.p);
  if (publicKey === null) {
    return { ...withRecord, outcome: "key-not-found", step: 9, reason: `The p tag is not a valid ${record.k} public key (7.2).` };
  }

  // Step 10: signature (section 6).
  const check = algorithm.verify(publicKey, signedMessage(envelope.signedPart), envelope.signature);
  if (!check.valid) return { ...withRecord, outcome: "invalid-signature", step: 10, reason: check.reason };

  // Step 11: payload (section 5), decoded only after the signature has been verified.
  let fields: Field[];
  try {
    fields = decodePayload(envelope.payload);
  } catch (e) {
    return { ...withRecord, ...rejection(e, 11, "malformed") };
  }

  // Step 12.
  return { ...withRecord, outcome: "valid", step: 12, reason: "The stamp was signed with the key published for its domain and key ID.", fields };
}

async function collectWarnings(verdict: Verdict, store: KeyStore | undefined): Promise<Warning[]> {
  const { envelope, record } = verdict;
  if (envelope === undefined) return [];
  const warnings = domainWarnings(envelope.domain, envelope.domainUnicode);
  if (verdict.resolvers === 1) {
    warnings.push({ code: "single-resolver", message: "Only one DNS resolver answered; the answer could not be compared (9.2)." });
  }
  if (store === undefined) return warnings;

  const previous = await store.get(envelope.lookupName);
  if (previous !== undefined && record !== undefined && previous !== record.text) {
    warnings.push({ code: "key-changed", message: `The key record at ${envelope.lookupName} differs from the one seen before (9.2).` });
  }
  if (previous !== undefined && record === undefined && verdict.outcome === "key-not-found") {
    warnings.push({ code: "key-disappeared", message: `The key record at ${envelope.lookupName} was seen before and is no longer published (9.2).` });
  }
  if (store.domains) {
    const similar = similarDomains(envelope.domainUnicode, await store.domains());
    if (similar.length > 0) {
      warnings.push({ code: "similar-domain", message: `The domain resembles ${similar.join(", ")}, of which stamps were verified before (9.3).` });
    }
  }
  return warnings;
}
