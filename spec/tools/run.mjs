// Runs the test vectors against the reference verifier.
//
//   node run.mjs            runs ../vectors/vectors.json, prints failures, exits 1 on any
//   node run.mjs --verbose  also prints the reason for every outcome
//
// This file is also the model for a harness in another language: build the
// simulated resolver from the vector's `dns` object, record every name the
// verifier queries, and compare outcome, queries and decoded data.

import { readFileSync } from "node:fs";
import { verifyStamp } from "./verify.mjs";

const file = JSON.parse(readFileSync(new URL("../vectors/vectors.json", import.meta.url), "utf8"));
const verbose = process.argv.includes("--verbose");

function resolverFor(dns, queries) {
  return async (name) => {
    queries.push(name);
    let entry = dns[name];
    for (let hops = 0; entry && entry.result === "cname"; hops++) {
      if (hops > 8) return { result: "failure" };
      entry = dns[entry.target];
    }
    if (!entry) return { result: "nxdomain" };
    if (entry.result === "answer") return { result: "answer", txt: entry.txt, dnssec: entry.dnssec };
    return { result: entry.result };
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let failed = 0;
for (const v of file.vectors) {
  const queries = [];
  const got = await verifyStamp(v.text, { now: v.now, resolve: resolverFor(v.dns, queries) });
  const e = v.expected, problems = [];
  if (got.outcome !== e.outcome) problems.push(`outcome ${got.outcome}, expected ${e.outcome}`);
  if (!same(queries, e.queries)) problems.push(`queries ${JSON.stringify(queries)}, expected ${JSON.stringify(e.queries)}`);
  if (e.outcome === "valid" && got.outcome === "valid") {
    for (const [k, gk] of [["domain", "domain"], ["domain_unicode", "domainUnicode"], ["key_id", "keyId"], ["issued_at", "issuedAt"], ["dnssec", "dnssec"], ["fields", "fields"]])
      if (!same(got[gk], e[k])) problems.push(`${k} differs`);
  }
  if (problems.length) { failed++; console.log(`FAIL ${v.id}: ${problems.join("; ")}${got.reason ? ` (${got.reason})` : ""}`); }
  else if (verbose) console.log(`ok   ${v.id.padEnd(40)} ${got.outcome.padEnd(18)} ${got.reason ?? ""}`);
}
console.log(`${file.vectors.length - failed} of ${file.vectors.length} vectors pass`);
process.exit(failed ? 1 : 0);
