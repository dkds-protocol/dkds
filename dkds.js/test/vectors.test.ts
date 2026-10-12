/**
 * Conformance: the DKDS version 1 test vectors, run through the public API.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyStamp, type DnsAnswer, type Resolver } from "../src/index.ts";

interface DnsEntry {
  result: "answer" | "cname" | "nxdomain" | "failure";
  txt?: string[][];
  dnssec?: boolean;
  target?: string;
}

interface Vector {
  id: string;
  text: string;
  now: number;
  dns: Record<string, DnsEntry>;
  expected: {
    outcome: string;
    queries: string[];
    domain?: string;
    domain_unicode?: string;
    key_id?: string;
    issued_at?: number;
    dnssec?: boolean;
    fields?: [string, string][];
  };
}

const file = JSON.parse(readFileSync(new URL("../../spec/vectors/vectors.json", import.meta.url), "utf8")) as { vectors: Vector[] };

/** A resolver answering from a vector's simulated DNS, following CNAMEs and recording each query. */
function simulatedResolver(dns: Record<string, DnsEntry>, queries: string[]): Resolver {
  return async (name) => {
    queries.push(name);
    let entry = dns[name];
    for (let hops = 0; entry?.result === "cname"; hops++) {
      if (hops > 8) return { result: "failure" };
      entry = dns[entry.target!];
    }
    if (entry === undefined || entry.result === "nxdomain") return { result: "nxdomain" };
    if (entry.result === "failure") return { result: "failure" };
    return { result: "answer", txt: entry.txt!, dnssec: entry.dnssec! } satisfies DnsAnswer;
  };
}

for (const v of file.vectors) {
  test(v.id, async () => {
    const queries: string[] = [];
    const result = await verifyStamp(v.text, { now: v.now, resolve: simulatedResolver(v.dns, queries) });
    assert.equal(result.outcome, v.expected.outcome, result.reason);
    assert.deepEqual(queries, v.expected.queries);
    if (v.expected.outcome === "valid") {
      assert.equal(result.domain, v.expected.domain);
      assert.equal(result.domainUnicode, v.expected.domain_unicode);
      assert.equal(result.keyId, v.expected.key_id);
      assert.equal(result.issuedAt, v.expected.issued_at);
      assert.equal(result.dnssec, v.expected.dnssec);
      assert.deepEqual(result.fields, v.expected.fields);
    } else {
      assert.equal(result.fields, undefined);
    }
  });
}
