/**
 * The signature algorithms implemented by this library, by the value of the `k` tag (specification 6.2).
 */

import { base64DecodeCanonical } from "../bytes.ts";
import { ed25519Verify, KEY_BYTES } from "./ed25519.ts";
import type { Algorithm } from "./types.ts";

const ed25519: Algorithm = {
  name: "ed25519",
  decodePublicKey(p) {
    const key = base64DecodeCanonical(p);
    return key !== null && key.length === KEY_BYTES ? key : null;
  },
  verify: ed25519Verify,
};

/** The algorithms of DKDS version 1. */
export const ALGORITHMS: ReadonlyMap<string, Algorithm> = new Map([[ed25519.name, ed25519]]);
