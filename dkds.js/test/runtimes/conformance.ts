/**
 * A conformance check that runs in every supported runtime against the built package: the test vectors,
 * and the text forms of a fixed set of stamps, which must be identical in every runtime.
 */

import { createStamp, verifyStamp, type Resolver } from "../../dist/index.js";

interface Vector {
  id: string;
  text: string;
  now: number;
  dns: Record<string, { result: string; txt?: string[][]; dnssec?: boolean; target?: string }>;
  expected: { outcome: string; queries: string[]; fields?: [string, string][] };
}

/** The result of {@link runConformance}. */
export interface Report {
  readonly vectors: number;
  readonly failures: string[];
  /** The text forms of the stamps of {@link STAMPS}, in order. */
  readonly texts: string[];
}

const SEED = new Uint8Array(32).fill(0x07);
const ISSUED_AT = 1790758800;

/** Stamps whose text forms are compared across runtimes. */
const STAMPS: { domain: string; fields: [string, string][] }[] = [
  { domain: "northwind.example", fields: [["Supplier", "Northwind B.V."], ["Invoice no.", "2026-0917"], ["Amount", "4,812.50 EUR"]] },
  { domain: "bücher.example", fields: [["Название", "Книга"], ["名前", "日本語のテキスト"], ["اسم", "نص عربي"], ["Leer", ""]] },
  { domain: "issuer.example", fields: Array.from({ length: 60 }, (_, i) => [`Field ${i}`, `Value ${i * 7919}`] as [string, string]) },
];

function resolverFor(dns: Vector["dns"], queries: string[]): Resolver {
  return async (name) => {
    queries.push(name);
    let entry = dns[name];
    for (let hops = 0; entry?.result === "cname"; hops++) {
      if (hops > 8) return { result: "failure" };
      entry = dns[entry.target!];
    }
    if (entry === undefined || entry.result === "nxdomain") return { result: "nxdomain" };
    if (entry.result === "failure") return { result: "failure" };
    return { result: "answer", txt: entry.txt!, dnssec: entry.dnssec! };
  };
}

/** Runs the vectors and creates the stamps of {@link STAMPS}. */
export async function runConformance(vectors: readonly Vector[]): Promise<Report> {
  const failures: string[] = [];
  for (const v of vectors) {
    const queries: string[] = [];
    const result = await verifyStamp(v.text, { now: v.now, resolve: resolverFor(v.dns, queries) });
    const same = result.outcome === v.expected.outcome && JSON.stringify(queries) === JSON.stringify(v.expected.queries) && JSON.stringify(result.fields) === JSON.stringify(v.expected.fields);
    if (!same) failures.push(`${v.id}: ${result.outcome} (${result.reason})`);
  }
  const texts: string[] = [];
  for (const s of STAMPS) {
    texts.push((await createStamp({ ...s, keyId: "k1", privateKey: SEED, issuedAt: ISSUED_AT })).text);
  }
  return { vectors: vectors.length, failures, texts };
}
