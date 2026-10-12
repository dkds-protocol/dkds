/**
 * The messages between the page and the QR decoder worker, and the test that tells a stamp from
 * another QR code. This module uses no browser interface, so that both sides can import it.
 */

/**
 * Returns true for text that is presented as a stamp: text beginning with "DKDS" in any case. Such
 * text is verified, and a defective stamp is reported with its outcome; any other QR code is reported
 * only as not being a stamp, without its content.
 */
export function isStampText(text: string): boolean {
  return /^dkds/i.test(text);
}

/** A request to the worker. The pixel buffer is transferred, not copied. */
export interface DecodeRequest {
  readonly id: number;
  readonly mode: "camera" | "file";
  readonly width: number;
  readonly height: number;
  readonly data: ArrayBuffer;
}

/** The codes found in one image: the texts of stamps, and the number of other QR codes. */
export interface Decoded {
  readonly stamps: readonly string[];
  readonly others: number;
}

/** A message from the worker. */
export type WorkerMessage =
  | { readonly type: "ready" }
  | { readonly type: "failed"; readonly message: string }
  | ({ readonly type: "result"; readonly id: number } & Decoded)
  | { readonly type: "error"; readonly id: number; readonly message: string };
