/**
 * The command-line tool and the local HTTP API, tested end to end against a local DNS over HTTPS
 * server.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createStamp, keyRecord, publicKeyOf, verifyStamp, type Resolver } from "../src/index.ts";
import { createApiServer } from "../src/node/index.ts";
import { parseRecordFile, RecordFileError } from "../src/node/records.ts";

const BIN = new URL("../src/node/bin.ts", import.meta.url);
const seed = new Uint8Array(32).fill(0x07);
const NOW = 1790758800;
const RECORD = keyRecord(publicKeyOf(seed));
const zone = new Map<string, string>([
  ["k1._dkds.issuer.example", RECORD],
  ["k3._dkds.issuer.example", keyRecord(null)],
]);

/** Encodes a DNS response with the TXT records of `zone` for the question in `query`. */
function dnsResponse(query: Buffer): Buffer {
  let offset = 12;
  const labels: string[] = [];
  while (query[offset]! > 0) {
    labels.push(query.subarray(offset + 1, offset + 1 + query[offset]!).toString("latin1"));
    offset += query[offset]! + 1;
  }
  const question = query.subarray(12, offset + 5);
  const record = zone.get(labels.join(".").toLowerCase());
  const flags = record === undefined ? 0x81a3 : 0x81a0;
  const answer = record === undefined ? [] : [0xc0, 12, 0, 16, 0, 1, 0, 0, 1, 0, 0, record.length + 1, record.length, ...Buffer.from(record, "latin1")];
  return Buffer.from([0, 0, flags >> 8, flags & 0xff, 0, 1, 0, record === undefined ? 0 : 1, 0, 0, 0, 0, ...question, ...answer]);
}

let doh: Server;
let dohUrl: string;

before(async () => {
  doh = createServer((req, res) => {
    const query = Buffer.from(new URL(req.url!, "http://x").searchParams.get("dns") ?? "", "base64url");
    res.writeHead(200, { "content-type": "application/dns-message" });
    res.end(dnsResponse(query));
  });
  await new Promise<void>((resolve) => doh.listen(0, "127.0.0.1", resolve));
  dohUrl = `http://127.0.0.1:${(doh.address() as AddressInfo).port}/dns-query`;
});

after(() => doh.close());

/** Runs the command asynchronously, so that the DNS server of this process can answer it. */
function dkds(args: string[], input?: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(BIN), ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

// ---- Command-line tool ------------------------------------------------------------------------

test("keygen, record, create, inspect and verify", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dkds-"));
  const keyFile = join(dir, "key.pem");

  const keygen = await dkds(["keygen", "--out", keyFile]);
  assert.equal(keygen.status, 0);
  assert.match(keygen.stdout, /^v=DKDS1; k=ed25519; p=[A-Za-z0-9+/]{43}=\n$/);
  if (process.platform !== "win32") assert.equal(statSync(keyFile).mode & 0o777, 0o600);
  assert.equal((await dkds(["keygen", "--out", keyFile])).status, 1);

  writeFileSync(keyFile, `-----BEGIN PRIVATE KEY-----\n${Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]).toString("base64")}\n-----END PRIVATE KEY-----\n`);
  const record = await dkds(["record", "--key", keyFile, "--domain", "issuer.example", "--key-id", "k1", "--check", "--resolver", dohUrl]);
  assert.equal(record.status, 0, record.stderr);
  assert.equal(record.stdout.split("\n")[0], `k1._dkds.issuer.example. TXT "${RECORD}"`);

  const fieldsFile = join(dir, "fields.json");
  writeFileSync(fieldsFile, JSON.stringify([["Invoice no.", "2026-0917"], ["Amount", "4,812.50 EUR"]]));
  const svgFile = join(dir, "stamp.svg");
  const created = await dkds(["create", "--key", keyFile, "--domain", "issuer.example", "--key-id", "k1", "--fields", fieldsFile, "--issued-at", "2026-09-30T09:00:00Z", "--svg", svgFile]);
  assert.equal(created.status, 0, created.stderr);
  const text = created.stdout.trim();
  assert.match(readFileSync(svgFile, "utf8"), /^<svg /);

  const inspected = await dkds(["inspect", "--json"], text + "\n");
  assert.equal(JSON.parse(inspected.stdout).issuedAt, NOW);

  const verified = await dkds(["verify", text, "--resolver", dohUrl, "--now", String(NOW)]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /^Outcome   valid\nDomain    issuer\.example\nIssued    2026-09-30 09:00:00 UTC\nDNSSEC    validated\n\nStated by issuer\.example\n  Invoice no\.  2026-0917\n  Amount       4,812\.50 EUR\n$/);

  const json = JSON.parse((await dkds(["verify", "-", "--json", "--resolver", dohUrl, "--now", String(NOW)], text)).stdout);
  assert.deepEqual(json.fields, [["Invoice no.", "2026-0917"], ["Amount", "4,812.50 EUR"]]);
});

test("keygen prints the record with its DNS name when given the domain and the key ID", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dkds-"));
  const keygen = await dkds(["keygen", "--out", join(dir, "k2.pem"), "--domain", "Issuer.Example", "--key-id", "k2"]);
  assert.equal(keygen.status, 0, keygen.stderr);
  assert.match(keygen.stdout, /^k2\._dkds\.issuer\.example\. TXT "v=DKDS1; k=ed25519; p=[A-Za-z0-9+/]{43}="\n$/);
  assert.equal((await dkds(["keygen", "--out", join(dir, "k3.pem"), "--domain", "issuer.example"])).status, 64);
  assert.equal((await dkds(["keygen", "--out", join(dir, "k4.pem"), "--domain", "issuer.example", "--key-id", "K4"])).status, 1);
  assert.throws(() => statSync(join(dir, "k4.pem")), "no key is written for an invalid key ID");
});

test("check compares every record of a file with the published one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dkds-"));
  const other = keyRecord(new Uint8Array(32).fill(1));
  const file = join(dir, "records.txt");

  writeFileSync(file, `; key records of issuer.example\nk1._dkds.issuer.example. TXT "${RECORD}"\n\nk3._dkds.issuer.example. 3600 IN TXT "v=DKDS1; k=ed25519; " "p="\n`);
  const ok = await dkds(["check", file, "--resolver", dohUrl]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, "matches     k1._dkds.issuer.example\nmatches     k3._dkds.issuer.example\n");

  writeFileSync(file, `k1._dkds.issuer.example. TXT "${other}"\nk2._dkds.issuer.example. TXT "${RECORD}"\nk3._dkds.issuer.example TXT "${RECORD}"\n`);
  const bad = await dkds(["check", file, "--resolver", dohUrl]);
  assert.equal(bad.status, 1);
  assert.equal(
    bad.stdout,
    `differs     k1._dkds.issuer.example: ${RECORD}\nmissing     k2._dkds.issuer.example\ndiffers     k3._dkds.issuer.example: ${keyRecord(null)}\n`,
  );

  writeFileSync(file, `k1._dkds.issuer.example. TXT "${RECORD}"\n`);
  const down = await dkds(["check", file, "--resolver", "http://127.0.0.1:9/dns-query"]);
  assert.equal(down.status, 2);
  assert.equal(down.stdout, "unavailable k1._dkds.issuer.example\n");

  writeFileSync(file, `k1._dkds.issuer.example. TXT ${RECORD}\n`);
  const malformed = await dkds(["check", file]);
  assert.equal(malformed.status, 64);
  assert.match(malformed.stderr, /, line 1: the record is not written as quoted strings\./);
  assert.equal((await dkds(["check"])).status, 64);
});

test("a file of key records is read in the forms of dkds record and of zone files", () => {
  const records = parseRecordFile(
    [
      "# comment",
      `K1._DKDS.Issuer.Example. 300 IN TXT "${RECORD.slice(0, 20)}" "${RECORD.slice(20)}" ; comment`,
      `k2._dkds.issuer.example txt "v=DKDS1; k=ed25519; p=" `,
      `k3._dkds.issuer.example. IN 60 TXT "v=DKDS1;\\032k=ed25519; p=\\"\\\\"`,
    ].join("\r\n"),
  );
  assert.deepEqual(
    records.map((r) => [r.line, r.name, r.record.text]),
    [
      [2, "k1._dkds.issuer.example", RECORD],
      [3, "k2._dkds.issuer.example", "v=DKDS1; k=ed25519; p="],
      [4, "k3._dkds.issuer.example", 'v=DKDS1; k=ed25519; p="\\'],
    ],
  );

  const error = (text: string) => assert.throws(() => parseRecordFile(text), RecordFileError);
  error("");
  error(`www.issuer.example. TXT "${RECORD}"`);
  error(`k1._dkds.issuer. TXT "${RECORD}"`);
  error(`k1._dkds.issuer.example. TXT "v=spf1 -all"`);
  error(`k1._dkds.issuer.example. TXT "${RECORD}`);
  error(`k1._dkds.issuer.example. A 192.0.2.1`);
  error(`k1._dkds.issuer.example. TXT "${RECORD}"\nk1._dkds.issuer.example. TXT "${RECORD}"`);
  assert.throws(() => parseRecordFile(`\n\nk1._dkds.issuer.example. TXT ""`), (e: RecordFileError) => e.line === 3);
});

test("exit status: 1 for not valid, 2 for unavailable, 64 for incorrect usage", async () => {
  assert.equal((await dkds(["verify", "DKDS:A", "--resolver", dohUrl])).status, 1);
  assert.equal((await dkds(["inspect", "DKDS:A"])).status, 1);
  assert.equal((await dkds(["verify", "DKDS:XYZ"])).status, 1);
  assert.equal((await dkds([])).status, 64);
  assert.equal((await dkds(["frobnicate"])).status, 64);
  assert.equal((await dkds(["verify", "--unknown-option"])).status, 64);
  assert.equal((await dkds(["create", "--domain", "issuer.example"])).status, 64);
  const dir = mkdtempSync(join(tmpdir(), "dkds-"));
  writeFileSync(join(dir, "fields.json"), "[[");
  assert.equal((await dkds(["create", "--key", "k", "--domain", "d.example", "--key-id", "k1", "--fields", join(dir, "fields.json")])).status, 64);
  assert.equal((await dkds(["create", "--key", "k", "--domain", "d.example", "--key-id", "k1", "--field", "A=1", "--issued-at", "2026-09-30 09:00"])).status, 64);
});

test("verify reports unavailable with exit status 2 when no resolver answers", async () => {
  const stamp = await createStamp({ domain: "issuer.example", keyId: "k1", privateKey: seed, issuedAt: NOW, fields: [["A", "1"]] });
  const r = await dkds(["verify", stamp.text, "--resolver", "http://127.0.0.1:9/dns-query", "--now", String(NOW)]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^Outcome   unavailable\n/);
});

// ---- Local HTTP API ---------------------------------------------------------------------------

const TOKEN = "test-token-0123456789";
let api: Server;
let port: number;

const resolve: Resolver = async (name) => (zone.has(name) ? { result: "answer", txt: [[zone.get(name)!]], dnssec: false } : { result: "nxdomain" });

before(async () => {
  api = createApiServer({ signing: { domain: "issuer.example", keyId: "k1", privateKey: seed, token: TOKEN }, resolve });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  port = (api.address() as AddressInfo).port;
});

after(() => api.close());

function call(method: string, path: string, options: { body?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...options.headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode!, body: data ? JSON.parse(data) : undefined }));
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

const json = { "content-type": "application/json" };
const auth = { ...json, authorization: `Bearer ${TOKEN}` };

test("GET / reports the protocol and package version", async () => {
  const r = await call("GET", "/");
  assert.equal(r.status, 200);
  assert.equal(r.body.dkds, "1");
});

test("POST /create signs with the configured key and POST /verify verifies", async () => {
  const created = await call("POST", "/create", { headers: auth, body: JSON.stringify({ fields: [["A", "1"]], issuedAt: NOW }) });
  assert.equal(created.status, 200);
  assert.match(created.body.svg, /^<svg /);
  const local = await verifyStamp(created.body.text, { now: NOW, resolve });
  assert.equal(local.outcome, "valid");
  const verified = await call("POST", "/verify", { headers: json, body: JSON.stringify({ text: created.body.text }) });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.outcome, "valid");
  assert.deepEqual(verified.body.fields, [["A", "1"]]);
});

test("the API refuses requests that do not meet its conditions", async () => {
  const body = JSON.stringify({ fields: [["A", "1"]] });
  const cases: [number, string, string, { body?: string; headers?: Record<string, string> }][] = [
    [401, "POST", "/create", { headers: json, body }],
    [401, "POST", "/create", { headers: { ...json, authorization: "Bearer wrong-token-0123456789" }, body }],
    [403, "POST", "/verify", { headers: { ...json, origin: "https://attacker.example" }, body: '{"text":"x"}' }],
    [421, "GET", "/", { headers: { host: "attacker.example" } }],
    [415, "POST", "/verify", { headers: { "content-type": "text/plain" }, body: '{"text":"x"}' }],
    [413, "POST", "/verify", { headers: json, body: JSON.stringify({ text: "x".repeat(70000) }) }],
    [400, "POST", "/verify", { headers: json, body: "{" }],
    [400, "POST", "/verify", { headers: json, body: "{}" }],
    [405, "GET", "/verify", {}],
    [404, "GET", "/nothing", {}],
    [422, "POST", "/create", { headers: auth, body: JSON.stringify({ fields: { A: "1" } }) }],
  ];
  for (const [status, method, path, options] of cases) {
    const r = await call(method, path, options);
    assert.equal(r.status, status, `${method} ${path} ${JSON.stringify(options.headers)}`);
    assert.equal(typeof r.body.error.code, "string");
  }
});

test("/create is absent when no key is configured; a short token and an invalid key are refused", async () => {
  assert.throws(() => createApiServer({ signing: { domain: "issuer.example", keyId: "k1", privateKey: seed, token: "short" } }));
  assert.throws(() => createApiServer({ signing: { domain: "issuer.example", keyId: "k1", privateKey: "not a key", token: TOKEN } }));
  const bare = createApiServer({ resolve });
  await new Promise<void>((r) => bare.listen(0, "127.0.0.1", r));
  const barePort = (bare.address() as AddressInfo).port;
  const status = await new Promise<number>((resolve) => {
    request({ host: "127.0.0.1", port: barePort, method: "POST", path: "/create", headers: { ...auth, host: `localhost:${barePort}` } }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    }).end("{}");
  });
  bare.close();
  assert.equal(status, 404);
});
