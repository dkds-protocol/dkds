// Checks that ../vectors/vectors.json is the fixed set of version 1, whose SHA-256 digest is recorded
// in ../vectors/vectors.json.sha256 (the format of sha256sum).
//
//   node check-frozen.mjs

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const recorded = readFileSync(new URL("../vectors/vectors.json.sha256", import.meta.url), "utf8").split(/\s+/)[0];
const actual = createHash("sha256").update(readFileSync(new URL("../vectors/vectors.json", import.meta.url))).digest("hex");
if (actual !== recorded) {
  console.log(`vectors.json has SHA-256 ${actual}; the fixed set of version 1 has ${recorded}.`);
  console.log("The vectors of version 1 change only by an erratum, which updates vectors.json.sha256.");
  process.exit(1);
}
console.log("vectors.json is the fixed set of version 1");
