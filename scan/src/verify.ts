/**
 * Verification of the stamps read from one input, with dkds.js and its default
 * resolvers.
 */

import { verifyStamp, type VerifyResult } from "../../dkds.js/src/index.ts";
import { similarDomains } from "../../dkds.js/src/warnings.ts";
import type { LocalKeyStore } from "./keystore.ts";

/** A stamp read from an input, with the pages of a PDF file on which it appears. */
export interface FoundStamp {
  readonly text: string;
  readonly pages: readonly number[];
}

/** A verified stamp. */
export interface CheckedStamp extends FoundStamp {
  readonly result: VerifyResult;
  /** For the warning `similar-domain`: the domains verified before that resemble this one. */
  readonly similar: readonly string[];
}

/** Verifies stamps one after another, so that each sees the key store as left by the previous one. */
export async function verifyAll(stamps: readonly FoundStamp[], keyStore: LocalKeyStore): Promise<CheckedStamp[]> {
  const checked: CheckedStamp[] = [];
  for (const stamp of stamps) {
    const known = [...(await keyStore.domains!())];
    const result = await verifyStamp(stamp.text, { keyStore });
    const similar = result.domainUnicode && result.warnings.some((w) => w.code === "similar-domain") ? similarDomains(result.domainUnicode, known) : [];
    checked.push({ ...stamp, result, similar });
  }
  return checked;
}
