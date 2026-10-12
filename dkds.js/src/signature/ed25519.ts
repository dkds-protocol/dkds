/**
 * Ed25519 (RFC 8032) with the verification rules of specification 6.3.
 *
 * Point arithmetic, SHA-512 and signing are provided by `@noble/curves` and `@noble/hashes`. The
 * checks of 6.3 are applied here, so that the result does not depend on the defaults of the library.
 */

import { ed25519 as noble } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesEqual, concat } from "../bytes.ts";
import type { SignatureCheck } from "./types.ts";

const Point = noble.Point;
type Point = InstanceType<typeof Point>;
const L = Point.Fn.ORDER;

/** Length of a public key and of a private key seed, in bytes. */
export const KEY_BYTES = 32;
/** Length of a signature, in bytes. */
export const SIGNATURE_BYTES = 64;

function littleEndian(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]!);
  return n;
}

/** Decodes a point and requires that encoding it again reproduces the same bytes (6.3, check 3). */
function decodeCanonical(bytes: Uint8Array): Point | null {
  let point: Point;
  try {
    point = Point.fromBytes(bytes, true);
  } catch {
    return null;
  }
  return bytesEqual(point.toBytes(), bytes) ? point : null;
}

/** Verifies a signature under the five checks of 6.3. */
export function ed25519Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): SignatureCheck {
  if (signature.length !== SIGNATURE_BYTES) return { valid: false, reason: "The signature is not 64 bytes long (6.3, check 1)." };
  const r = signature.subarray(0, 32);
  const s = littleEndian(signature.subarray(32));
  if (s >= L) return { valid: false, reason: "S is not below the group order L (6.3, check 2)." };
  const A = publicKey.length === KEY_BYTES ? decodeCanonical(publicKey) : null;
  const R = decodeCanonical(r);
  if (!A || !R) return { valid: false, reason: "A or R is not a canonically encoded curve point (6.3, check 3)." };
  if (A.isSmallOrder() || R.isSmallOrder()) return { valid: false, reason: "A or R is a point of small order (6.3, check 4)." };
  const k = littleEndian(sha512(concat(r, publicKey, message))) % L;
  const check = Point.BASE.multiplyUnsafe(s).subtract(A.multiplyUnsafe(k)).toBytes();
  if (!bytesEqual(check, r)) return { valid: false, reason: "[S]B - [k]A is not equal to R (6.3, check 5)." };
  return { valid: true };
}

/** Signs a message with a 32-byte private key seed (RFC 8032, 5.1.6). */
export function ed25519Sign(seed: Uint8Array, message: Uint8Array): Uint8Array {
  return noble.sign(message, seed);
}

/** Returns the public key of a 32-byte private key seed (RFC 8032, 5.1.5). */
export function ed25519PublicKey(seed: Uint8Array): Uint8Array {
  return noble.getPublicKey(seed);
}
