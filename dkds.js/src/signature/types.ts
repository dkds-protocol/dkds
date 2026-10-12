/** The result of checking a signature. */
export type SignatureCheck = { readonly valid: true } | { readonly valid: false; readonly reason: string };

/**
 * A signature algorithm, named by the `k` tag of a key record (specification 6.2). Later algorithms are
 * added as further implementations of this interface (section 11).
 */
export interface Algorithm {
  /** The value of the `k` tag. */
  readonly name: string;
  /** Decodes the value of the `p` tag. Returns `null` when it is not a valid key (8.2, step 9). */
  decodePublicKey(p: string): Uint8Array | null;
  /** Checks a signature over a message (8.2, step 10). */
  verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): SignatureCheck;
}
