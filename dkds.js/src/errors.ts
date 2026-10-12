/**
 * Error codes of {@link DkdsError}. Each code is stable across releases of the same major version.
 */
export type ErrorCode =
  // Programming errors: a function was called with arguments of the wrong type or shape.
  | "invalid-argument"
  // Carrier (specification section 3).
  | "text-invalid"
  | "base45-invalid"
  // Envelope (section 4).
  | "envelope-invalid"
  | "domain-invalid"
  | "key-id-invalid"
  | "lookup-name-too-long"
  | "too-large"
  // Payload (section 5).
  | "fields-invalid"
  | "field-name-invalid"
  | "field-name-duplicate"
  | "field-value-invalid"
  | "forbidden-code-point"
  | "utf8-invalid"
  | "deflate-invalid"
  | "payload-too-large"
  // Keys and signatures (sections 6 and 7).
  | "key-invalid"
  | "record-invalid"
  | "signer-mismatch"
  // QR code (section 3.3).
  | "qr-invalid";

/**
 * The error thrown by every function of the library. `code` identifies the rule that was not met;
 * `message` explains it and cites the section of the specification where one applies.
 */
export class DkdsError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "DkdsError";
    this.code = code;
  }
}

/** Throws a {@link DkdsError}. */
export function fail(code: ErrorCode, message: string): never {
  throw new DkdsError(code, message);
}
