/**
 * DNS messages, DNS over HTTPS and the combination of resolvers.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeTxtQuery, parseTxtResponse } from "../src/discovery/message.ts";
import { combineResolvers, dohResolver, type DnsAnswer, type Resolver } from "../src/index.ts";

const NAME = "k1._dkds.issuer.example";

function encodeName(name: string): number[] {
  return [...name.split(".").flatMap((l) => [l.length, ...Buffer.from(l, "latin1")]), 0];
}

interface Rr {
  name: number[];
  type: number;
  rdata: number[];
}

const txtRr = (name: string | number[], ...strings: string[]): Rr => ({
  name: typeof name === "string" ? encodeName(name) : name,
  type: 16,
  rdata: strings.flatMap((s) => [s.length, ...Buffer.from(s, "latin1")]),
});
const cnameRr = (name: string, target: string): Rr => ({ name: encodeName(name), type: 5, rdata: encodeName(target) });

/** Builds a response; `flags` defaults to a NOERROR answer with QR and RD set. */
function response(answers: Rr[], options: { flags?: number; id?: number; qname?: string; qtype?: number } = {}): Uint8Array<ArrayBuffer> {
  const flags = options.flags ?? 0x8180;
  const header = [(options.id ?? 0) >> 8, (options.id ?? 0) & 0xff, flags >> 8, flags & 0xff, 0, 1, 0, answers.length, 0, 0, 0, 0];
  const question = [...encodeName(options.qname ?? NAME), 0, options.qtype ?? 16, 0, 1];
  const records = answers.flatMap((rr) => [...rr.name, 0, rr.type, 0, 1, 0, 0, 1, 0, rr.rdata.length >> 8, rr.rdata.length & 0xff, ...rr.rdata]);
  return Uint8Array.from([...header, ...question, ...records]);
}

test("the query asks for TXT with ID 0, RD, AD and the DNSSEC OK bit", () => {
  const q = encodeTxtQuery(NAME);
  assert.deepEqual([...q.subarray(0, 12)], [0, 0, 0x01, 0x20, 0, 1, 0, 0, 0, 0, 0, 1]);
  const opt = q.subarray(q.length - 11);
  assert.deepEqual([...opt], [0, 0, 41, 0x04, 0xd0, 0, 0, 0x80, 0, 0, 0]);
});

test("TXT records with several character strings are returned per record", () => {
  const answer = parseTxtResponse(response([txtRr(NAME, "v=DKDS1; k=ed25519; ", "p=abc"), txtRr(NAME, "other")]), NAME);
  assert.deepEqual(answer, { result: "answer", txt: [["v=DKDS1; k=ed25519; ", "p=abc"], ["other"]], dnssec: false });
});

test("the AD bit gives the DNSSEC status", () => {
  const answer = parseTxtResponse(response([txtRr(NAME, "x")], { flags: 0x81a0 }), NAME);
  assert.equal(answer.result === "answer" && answer.dnssec, true);
});

test("compression pointers are followed and names are compared without case", () => {
  const pointer = [0xc0, 12];
  const answer = parseTxtResponse(response([txtRr(pointer, "x")]), "K1._DKDS.Issuer.Example");
  assert.deepEqual(answer, { result: "answer", txt: [["x"]], dnssec: false });
});

test("CNAME chains are followed to the TXT records of the target", () => {
  const answer = parseTxtResponse(
    response([cnameRr(NAME, "a.example"), cnameRr("a.example", "b.example"), txtRr("b.example", "target"), txtRr("a.example", "not the target")]),
    NAME,
  );
  assert.deepEqual(answer, { result: "answer", txt: [["target"]], dnssec: false });
});

test("NXDOMAIN, NODATA, SERVFAIL and truncated responses", () => {
  assert.deepEqual(parseTxtResponse(response([], { flags: 0x8183 }), NAME), { result: "nxdomain" });
  assert.deepEqual(parseTxtResponse(response([]), NAME), { result: "answer", txt: [], dnssec: false });
  assert.equal(parseTxtResponse(response([], { flags: 0x8182 }), NAME).result, "failure");
  assert.equal(parseTxtResponse(response([txtRr(NAME, "x")], { flags: 0x8380 }), NAME).result, "failure");
});

test("malformed and mismatched responses give failure", () => {
  const valid = response([txtRr(NAME, "x")]);
  const cases: Uint8Array[] = [
    valid.subarray(0, valid.length - 1),
    response([txtRr(NAME, "x")], { id: 7 }),
    response([txtRr(NAME, "x")], { flags: 0x0180 }),
    response([txtRr(NAME, "x")], { qname: "other.example" }),
    response([txtRr(NAME, "x")], { qtype: 1 }),
    response([{ name: [0xc0, 60], type: 16, rdata: [1, 0x78] }]),
    response([{ name: encodeName(NAME), type: 16, rdata: [5, 0x78] }]),
    new Uint8Array(0),
  ];
  for (const c of cases) assert.equal(parseTxtResponse(c, NAME).result, "failure");
});

test("a compression pointer loop gives failure", () => {
  const message = response([{ name: [0xc0, 0], type: 16, rdata: [] }]);
  const loopAt = message.length - 12;
  message[loopAt] = 0xc0;
  message[loopAt + 1] = loopAt;
  assert.equal(parseTxtResponse(message, NAME).result, "failure");
});

test("dohResolver sends a GET request with the query and parses the response", async () => {
  let requested: URL | undefined;
  const fakeFetch = (async (input: URL, init: RequestInit) => {
    requested = input;
    assert.equal(new Headers(init.headers).get("accept"), "application/dns-message");
    return new Response(response([txtRr(NAME, "x")]), { headers: { "content-type": "application/dns-message" } });
  }) as unknown as typeof fetch;
  const answer = await dohResolver("https://dns.example/dns-query", { fetch: fakeFetch })(NAME);
  assert.deepEqual(answer, { result: "answer", txt: [["x"]], dnssec: false });
  assert.equal(requested?.origin + requested!.pathname, "https://dns.example/dns-query");
  assert.equal(Buffer.from(requested!.searchParams.get("dns")!, "base64url").toString("hex"), Buffer.from(encodeTxtQuery(NAME)).toString("hex"));
});

test("dohResolver reports HTTP errors, wrong media types, network errors and timeouts as failure", async () => {
  const cases: (typeof fetch)[] = [
    (async () => new Response("", { status: 500 })) as unknown as typeof fetch,
    (async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch,
    (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch,
    ((_: URL, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch,
  ];
  for (const fakeFetch of cases) {
    const answer = await dohResolver("https://dns.example/dns-query", { fetch: fakeFetch, timeout: 50 })(NAME);
    assert.equal(answer.result, "failure");
  }
});

const fixed = (answer: DnsAnswer | Error): Resolver => async () => {
  if (answer instanceof Error) throw answer;
  return answer;
};
const A = (txt: string[][], dnssec = true): DnsAnswer => ({ result: "answer", txt, dnssec });

test("combineResolvers follows specification 9.2", async () => {
  const fail: DnsAnswer = { result: "failure" };
  const nx: DnsAnswer = { result: "nxdomain" };
  const run = (a: DnsAnswer | Error, b: DnsAnswer | Error) => combineResolvers(fixed(a), fixed(b))(NAME);

  assert.deepEqual(await run(A([["a"], ["b"]]), A([["b"], ["a"]])), { result: "answer", txt: [["a"], ["b"]], dnssec: true, resolvers: 2 });
  assert.deepEqual(await run(A([["a"]], true), A([["a"]], false)), { result: "answer", txt: [["a"]], dnssec: false, resolvers: 2 });
  assert.equal((await run(A([["a"]]), A([["b"]]))).result, "failure");
  assert.deepEqual(await run(A([["a", "b"]]), A([["ab"]])), { result: "answer", txt: [["a", "b"]], dnssec: true, resolvers: 2 });
  assert.equal((await run(A([]), nx)).result, "failure");
  assert.deepEqual(await run(nx, nx), { result: "nxdomain", resolvers: 2 });
  assert.deepEqual(await run(A([["a"]]), fail), { result: "answer", txt: [["a"]], dnssec: true, resolvers: 1 });
  assert.deepEqual(await run(new Error("boom"), A([["a"]])), { result: "answer", txt: [["a"]], dnssec: true, resolvers: 1 });
  assert.equal((await run(fail, fail)).result, "failure");
});
