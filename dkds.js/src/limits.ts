/**
 * The limits of DKDS version 1 (specification, Appendix A).
 */
export const LIMITS = Object.freeze({
  /** Maximum length of the text form, in characters (3.1). */
  textLength: 1637,
  /** Maximum length of the envelope, in bytes (4.1). */
  envelopeBytes: 1088,
  /** Maximum length of the lookup name, in characters (4.2). */
  lookupNameLength: 253,
  /** Maximum length of a domain label, in characters (4.2). */
  labelLength: 63,
  /** Maximum length of a key ID, in characters (4.3). */
  keyIdLength: 16,
  /** Maximum number of fields (5.1). */
  fieldCount: 255,
  /** Maximum length of a field name, in bytes (5.1). */
  fieldNameBytes: 255,
  /** Maximum length of a field value, in bytes (5.1). */
  fieldValueBytes: 65535,
  /** Maximum length of the decompressed payload, in bytes (5.2). */
  inflatedBytes: 16384,
  /** Maximum amount by which `issued_at` may exceed the verifier's clock, in seconds (8.2 step 5). */
  clockToleranceSeconds: 600,
});

/** The protocol version implemented by this library (4.4). */
export const VERSION = 0x01;

/** The prefix of the text form (3.1). */
export const TEXT_PREFIX = "DKDS:";

/** The domain separator prepended to the signed part to form the signed message (6.1). */
export const MESSAGE_PREFIX = "DKDS";
