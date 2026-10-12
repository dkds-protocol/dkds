/**
 * Conditions that end an input without a result, each shown on its own screen.
 */

export type ProblemKind =
  | "camera-denied"
  | "camera-missing"
  | "camera-busy"
  | "camera-unsupported"
  | "camera-insecure"
  | "camera-stopped"
  | "file-type"
  | "file-too-large"
  | "file-empty"
  | "image-unreadable"
  | "pdf-unreadable"
  | "pdf-unavailable"
  | "no-code"
  | "not-stamp"
  | "reader-failed"
  | "unexpected";

/** Details shown with a problem. */
export interface ProblemDetail {
  /** The file's name. */
  readonly name?: string;
  /** The PDF pages read, for "no-code". */
  readonly pages?: number;
  /** The number of QR codes found, for "not-stamp". */
  readonly count?: number;
  /** The error message, for "unexpected". */
  readonly message?: string;
}

/** A condition that ends an input. */
export class Problem extends Error {
  readonly kind: ProblemKind;
  readonly detail: ProblemDetail;

  constructor(kind: ProblemKind, detail: ProblemDetail = {}) {
    super(kind);
    this.kind = kind;
    this.detail = detail;
  }
}

/** Raised when the reader stops an input. */
export class Cancelled extends Error {}
