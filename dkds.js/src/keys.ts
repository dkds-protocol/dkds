/**
 * Ed25519 keys: generation, PKCS#8 PEM (RFC 5958, RFC 8410) and signers.
 */

import { base64DecodeCanonical, base64Encode, bytesEqual, concat } from "./bytes.ts";
import { fail } from "./errors.ts";
import { ed25519PublicKey, ed25519Sign, KEY_BYTES } from "./signature/ed25519.ts";

/**
 * Produces signatures for one public key. A signer can keep its private key outside the process, for
 * example in a hardware security module or a key management service.
 */
export interface Signer {
  /** The 32-byte Ed25519 public key. */
  readonly publicKey: Uint8Array;
  /** Returns the 64-byte Ed25519 signature (RFC 8032) of `message`. */
  sign(message: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

/** A private key: a PKCS#8 PEM string, or a 32-byte seed (RFC 8032, 5.1.5). */
export type PrivateKey = string | Uint8Array;

/** A newly generated key pair. */
export interface KeyPair {
  /** The private key as PKCS#8 PEM. */
  readonly privateKey: string;
  /** The 32-byte public key. */
  readonly publicKey: Uint8Array;
}

/** DER encoding of PKCS#8 version 1 for Ed25519, up to the 32-byte seed (RFC 8410, 7). */
const PKCS8_V1_PREFIX = Uint8Array.of(0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20);
/** DER encoding of PKCS#8 version 2 for Ed25519 with the public key, up to the seed (RFC 8410, 10.3). */
const PKCS8_V2_PREFIX = Uint8Array.of(0x30, 0x51, 0x02, 0x01, 0x01, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20);
/** DER encoding between the seed and the public key in PKCS#8 version 2. */
const PKCS8_V2_PUBLIC = Uint8Array.of(0x81, 0x21, 0x00);

const PEM_LABEL = "PRIVATE KEY";

/** Generates a key pair from the runtime's cryptographically secure random number generator. */
export function generateKey(): KeyPair {
  const seed = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return { privateKey: encodePrivateKeyPem(seed), publicKey: ed25519PublicKey(seed) };
}

/** Encodes a 32-byte seed as a PKCS#8 PEM private key. */
export function encodePrivateKeyPem(seed: Uint8Array): string {
  const body = base64Encode(concat(PKCS8_V1_PREFIX, seed)).replace(/.{1,64}/g, "$&\n");
  return `-----BEGIN ${PEM_LABEL}-----\n${body}-----END ${PEM_LABEL}-----\n`;
}

/**
 * Returns the 32-byte seed of a private key. Accepts a seed, or a PEM string holding an Ed25519 key in
 * PKCS#8 version 1, or version 2 with a public key that matches the seed. Throws `key-invalid`.
 */
export function privateKeySeed(key: PrivateKey): Uint8Array {
  if (key instanceof Uint8Array) {
    if (key.length !== KEY_BYTES) fail("key-invalid", "A private key seed is 32 bytes.");
    return key;
  }
  if (typeof key !== "string") return fail("key-invalid", "A private key is a PEM string or a 32-byte Uint8Array.");
  const match = /-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----/.exec(key);
  const der = match ? base64DecodeCanonical(match[1]!.replace(/\s+/g, "")) : null;
  if (der === null) return fail("key-invalid", "The private key is not a PEM-encoded PKCS#8 key.");

  if (der.length === PKCS8_V1_PREFIX.length + KEY_BYTES && bytesEqual(der.subarray(0, PKCS8_V1_PREFIX.length), PKCS8_V1_PREFIX)) {
    return der.slice(PKCS8_V1_PREFIX.length);
  }
  const v2Length = PKCS8_V2_PREFIX.length + KEY_BYTES + PKCS8_V2_PUBLIC.length + KEY_BYTES;
  if (der.length === v2Length && bytesEqual(der.subarray(0, PKCS8_V2_PREFIX.length), PKCS8_V2_PREFIX)) {
    const seed = der.slice(PKCS8_V2_PREFIX.length, PKCS8_V2_PREFIX.length + KEY_BYTES);
    const marker = der.subarray(PKCS8_V2_PREFIX.length + KEY_BYTES, v2Length - KEY_BYTES);
    if (bytesEqual(marker, PKCS8_V2_PUBLIC) && bytesEqual(der.subarray(v2Length - KEY_BYTES), ed25519PublicKey(seed))) return seed;
  }
  return fail("key-invalid", "The private key is not an Ed25519 key in PKCS#8 format (RFC 8410).");
}

/** Returns the public key of a private key. Throws `key-invalid`. */
export function publicKeyOf(key: PrivateKey): Uint8Array {
  return ed25519PublicKey(privateKeySeed(key));
}

/** Returns a signer that holds a private key in memory. Throws `key-invalid`. */
export function keySigner(key: PrivateKey): Signer {
  const seed = privateKeySeed(key).slice();
  return {
    publicKey: ed25519PublicKey(seed),
    sign: (message) => ed25519Sign(seed, message),
  };
}
