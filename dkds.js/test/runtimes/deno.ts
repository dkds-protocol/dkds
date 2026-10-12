/**
 * Runs the conformance check in Deno and prints the report as JSON.
 */

import { runConformance } from "./conformance.ts";

/** The part of the Deno namespace used here. */
declare const Deno: { readTextFile(path: URL): Promise<string> };

const vectors = JSON.parse(await Deno.readTextFile(new URL("../../../spec/vectors/vectors.json", import.meta.url))).vectors;
console.log(JSON.stringify(await runConformance(vectors)));
