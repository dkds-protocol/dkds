/**
 * The envelope (specification section 4).
 *
 * ```
 * version(1) domain_len(1) domain keyid_len(1) key_id issued_at(4) payload_len(2) payload signature
 * ```
 */

import { asciiBytes, concat, latin1String } from "./bytes.ts";
import { checkKeyId, lookupName, parseDomain } from "./domain.ts";
import { fail } from "./errors.ts";
import { LIMITS, MESSAGE_PREFIX, VERSION } from "./limits.ts";

/** The header fields of an envelope. */
export interface Header {
  /** The issuer's domain, in ASCII form (4.2). */
  readonly domain: string;
  /** The key ID (4.3). */
  readonly keyId: string;
  /** Time of signing, in seconds since 1970-01-01T00:00:00Z, excluding leap seconds. */
  readonly issuedAt: number;
}

/** A parsed envelope. */
export interface Envelope extends Header {
  /** The domain in Unicode form (4.2). */
  readonly domainUnicode: string;
  /** The DNS name of the key record, `<key_id>._dkds.<domain>` (4.2). */
  readonly lookupName: string;
  /** The compressed payload (section 5). */
  readonly payload: Uint8Array;
  /** The part of the envelope before the signature (4.1). */
  readonly signedPart: Uint8Array;
  /** The signature (section 6). */
  readonly signature: Uint8Array;
}

/** Returns the version byte of an envelope, or `undefined` for an empty envelope (4.4). */
export function envelopeVersion(envelope: Uint8Array): number | undefined {
  return envelope[0];
}

/** Returns true for the version values that are reserved and never assigned: 0x00 and 0xFF (4.4). */
export function isReservedVersion(version: number): boolean {
  return version === 0x00 || version === 0xff;
}

/**
 * Encodes the signed part of an envelope. The domain and key ID must already satisfy 4.2 and 4.3.
 * Throws `envelope-invalid` when `issuedAt` or the payload length is out of range.
 */
export function encodeSignedPart(header: Header, payload: Uint8Array): Uint8Array {
  const { domain, keyId, issuedAt } = header;
  if (!Number.isInteger(issuedAt) || issuedAt < 0 || issuedAt > 0xffffffff) {
    fail("envelope-invalid", "issued_at must be an integer from 0 to 4294967295 (4.1).");
  }
  if (payload.length < 1 || payload.length > 0xffff) fail("envelope-invalid", "payload_len must be 1 to 65535 (4.1).");
  const fixed = new Uint8Array(6);
  const view = new DataView(fixed.buffer);
  view.setUint32(0, issuedAt);
  view.setUint16(4, payload.length);
  return concat(
    Uint8Array.of(VERSION, domain.length),
    asciiBytes(domain),
    Uint8Array.of(keyId.length),
    asciiBytes(keyId),
    fixed,
    payload,
  );
}

/** Returns the signed message: `"DKDS" || signed_part` (6.1). */
export function signedMessage(signedPart: Uint8Array): Uint8Array {
  return concat(asciiBytes(MESSAGE_PREFIX), signedPart);
}

/**
 * Parses an envelope of version 1 and checks every rule of section 4. Throws `envelope-invalid`,
 * `domain-invalid`, `key-id-invalid` or `lookup-name-too-long`.
 */
export function parseEnvelope(envelope: Uint8Array): Envelope {
  if (envelope.length > LIMITS.envelopeBytes) {
    fail("envelope-invalid", `The envelope has ${envelope.length} bytes; the maximum is ${LIMITS.envelopeBytes} (4.1).`);
  }
  let offset = 0;
  const take = (n: number, field: string): Uint8Array => {
    if (offset + n > envelope.length) fail("envelope-invalid", `The field ${field} extends past the end of the envelope (4.1).`);
    return envelope.subarray(offset, (offset += n));
  };
  if (take(1, "version")[0] !== VERSION) fail("envelope-invalid", "The envelope is not of version 1 (4.4).");

  const domainLength = take(1, "domain_len")[0]!;
  if (domainLength < 1) fail("domain-invalid", "The domain is empty (4.2).");
  const domain = latin1String(take(domainLength, "domain"));
  const keyIdLength = take(1, "keyid_len")[0]!;
  if (keyIdLength < 1 || keyIdLength > LIMITS.keyIdLength) fail("key-id-invalid", "keyid_len is not 1 to 16 (4.1).");
  const keyId = latin1String(take(keyIdLength, "key_id"));
  const fixed = take(6, "issued_at and payload_len");
  const view = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength);
  const issuedAt = view.getUint32(0);
  const payloadLength = view.getUint16(4);
  if (payloadLength < 1) fail("envelope-invalid", "payload_len is 0 (4.1).");
  const payload = take(payloadLength, "payload");
  const signedPart = envelope.subarray(0, offset);
  const signature = envelope.subarray(offset);
  if (signature.length < 1) fail("envelope-invalid", "The envelope has no signature bytes (4.1).");

  const domainUnicode = parseDomain(domain);
  checkKeyId(keyId);
  return {
    domain,
    domainUnicode,
    keyId,
    issuedAt,
    lookupName: lookupName(keyId, domain),
    payload,
    signedPart,
    signature,
  };
}
