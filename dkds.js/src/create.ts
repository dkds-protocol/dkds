/**
 * Creation of a stamp: fields, payload, envelope, signature, text form and QR code.
 */

import { encodeQr, type QrCode } from "./carrier/qr.ts";
import { renderSvg, type SvgOptions } from "./carrier/svg.ts";
import { encodeText } from "./carrier/text.ts";
import { concat } from "./bytes.ts";
import { checkKeyId, lookupName, toAsciiDomain } from "./domain.ts";
import { encodeSignedPart, signedMessage } from "./envelope.ts";
import { fail } from "./errors.ts";
import { keySigner, type PrivateKey, type Signer } from "./keys.ts";
import { LIMITS } from "./limits.ts";
import { encodePayload, normalizeFields, type Field } from "./payload/fields.ts";
import { ed25519Verify, KEY_BYTES, SIGNATURE_BYTES } from "./signature/ed25519.ts";

/** Options of {@link createStamp}. */
export interface CreateOptions {
  /** The issuer's domain, in ASCII or Unicode form. */
  readonly domain: string;
  /** The key ID under which the public key is published (4.3). */
  readonly keyId: string;
  /** The fields, in display order, as `[name, value]` pairs or a `Map`. */
  readonly fields: readonly Field[] | ReadonlyMap<string, string>;
  /** The private key. Exactly one of `privateKey` and `signer` is given. */
  readonly privateKey?: PrivateKey;
  /** A signer, for keys held outside the process. Exactly one of `privateKey` and `signer` is given. */
  readonly signer?: Signer;
  /** The time of signing, in Unix seconds. Default: the system clock. */
  readonly issuedAt?: number;
  /** Options for the SVG rendering of the QR code. */
  readonly svg?: SvgOptions;
}

/** A created stamp. */
export interface Stamp {
  /** The text form (3.1). */
  readonly text: string;
  /** The envelope (section 4). */
  readonly envelope: Uint8Array;
  /** The QR code (3.3). */
  readonly qr: QrCode;
  /** The QR code as an SVG document, black on white, at its printed size. */
  readonly svg: string;
}

/**
 * Creates a stamp. Every rule that a verifier checks is checked here, and the signature is verified
 * under the rules of 6.3 before the stamp is returned, and an `issuedAt` more than 600 seconds after the
 * system clock is refused. Names and values are normalised to NFC. Throws a
 * {@link DkdsError} when an input does not satisfy the specification, when the stamp exceeds the size
 * limit (`too-large`), or when the signature does not verify under the signer's public key
 * (`signer-mismatch`).
 */
export async function createStamp(options: CreateOptions): Promise<Stamp> {
  if (typeof options !== "object" || options === null) fail("invalid-argument", "createStamp requires an options object.");
  const signer = resolveSigner(options);
  const domain = toAsciiDomain(options.domain);
  checkKeyId(options.keyId);
  lookupName(options.keyId, domain);
  const now = Math.floor(Date.now() / 1000);
  const issuedAt = options.issuedAt ?? now;
  if (typeof issuedAt === "number" && issuedAt > now + LIMITS.clockToleranceSeconds) {
    fail("envelope-invalid", "issuedAt is more than 600 seconds after the system clock; verifiers reject such a stamp as malformed (8.2, step 5).");
  }
  const payload = encodePayload(normalizeFields(options.fields));
  const signedPart = encodeSignedPart({ domain, keyId: options.keyId, issuedAt }, payload);

  const size = signedPart.length + SIGNATURE_BYTES;
  if (size > LIMITS.envelopeBytes) {
    fail("too-large", `The stamp would have an envelope of ${size} bytes; the maximum is ${LIMITS.envelopeBytes} (4.1). The payload is ${payload.length} bytes after compression.`);
  }

  const message = signedMessage(signedPart);
  const signature = await signer.sign(message);
  if (!(signature instanceof Uint8Array) || !ed25519Verify(signer.publicKey, message, signature).valid) {
    fail("signer-mismatch", "The signature does not verify under the signer's public key (6.3).");
  }

  const envelope = concat(signedPart, signature);
  const text = encodeText(envelope);
  const qr = encodeQr(text);
  return { text, envelope, qr, svg: renderSvg(qr, options.svg) };
}

function resolveSigner(options: CreateOptions): Signer {
  const hasKey = options.privateKey !== undefined;
  const hasSigner = options.signer !== undefined;
  if (hasKey === hasSigner) fail("invalid-argument", "Exactly one of privateKey and signer must be given.");
  if (hasKey) return keySigner(options.privateKey!);
  const signer = options.signer!;
  if (!(signer.publicKey instanceof Uint8Array) || signer.publicKey.length !== KEY_BYTES || typeof signer.sign !== "function") {
    fail("invalid-argument", "A signer has a 32-byte publicKey and a sign function.");
  }
  return signer;
}
