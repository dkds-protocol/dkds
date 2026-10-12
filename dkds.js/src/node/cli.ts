/**
 * The `dkds` command.
 *
 * Exit status: 0 for success and for the outcome `valid`; 1 for every other outcome except
 * `unavailable`, and for a failed `record --check`; 2 for `unavailable`; 64 for incorrect usage.
 */

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { createStamp } from "../create.ts";
import { dohResolver, defaultResolver } from "../discovery/doh.ts";
import { formatKeyRecord, selectKeyRecord } from "../discovery/record.ts";
import { combineResolvers, safeResolve, type Resolver } from "../discovery/resolver.ts";
import { checkKeyId, lookupName, toAsciiDomain } from "../domain.ts";
import { DkdsError } from "../errors.ts";
import { inspectStamp } from "../inspect.ts";
import { generateKey, publicKeyOf } from "../keys.ts";
import { verifyStamp, type VerifyResult } from "../verify.ts";
import { createApiServer } from "./serve.ts";
import { PACKAGE_VERSION } from "./version.ts";

const EXIT_OK = 0;
const EXIT_NOT_VALID = 1;
const EXIT_UNAVAILABLE = 2;
const EXIT_USAGE = 64;

const USAGE = `Usage: dkds <command> [options]

Commands:
  keygen --out <file>
      Generate a key. Write the private key as PKCS#8 PEM; print the key record.
  record --key <file> --domain <domain> --key-id <id> [--check]
  record --revoke --domain <domain> --key-id <id>
      Print the DNS record to publish. With --check, compare it with the published record.
  create --key <file> --domain <domain> --key-id <id>
         (--field <name>=<value> ... | --fields <file.json>) [--issued-at <time>] [--svg <file>]
      Create a stamp. Print its text form; write its QR code with --svg.
  verify [<text> | -] [--json] [--resolver <url> ...] [--now <time>]
      Verify a stamp given as an argument or on standard input.
  inspect [<text> | -] [--json]
      Show the header of a stamp without verifying it.
  serve [--host <address>] [--port <port>] [--key <file> --domain <domain> --key-id <id>]
      Start the local HTTP API. The token for /create is read from DKDS_TOKEN or generated.

Times are Unix seconds or ISO 8601 with a time zone, for example 2026-09-30T09:00:00Z.
Exit status: 0 success or valid; 1 not valid; 2 unavailable; 64 incorrect usage.
`;

class UsageError extends Error {}

function parse<T extends NonNullable<ParseArgsConfig["options"]>>(args: string[], options: T, positionals = 0) {
  let parsed;
  try {
    parsed = parseArgs({ args, options, allowPositionals: positionals > 0, strict: true });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  if (parsed.positionals.length > positionals) throw new UsageError("Too many arguments.");
  return parsed;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new UsageError(`--${name} is required.`);
  return value;
}

/** Parses Unix seconds or ISO 8601 with an explicit time zone. */
function parseTime(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) throw new UsageError(`The time "${value}" has no time zone.`);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new UsageError(`The time "${value}" is not valid.`);
  return Math.floor(ms / 1000);
}

function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

/** Returns the stamp from the argument, or from standard input when it is absent or "-". */
function readStamp(positional: string | undefined): string {
  if (positional !== undefined && positional !== "-") return positional;
  return readFileSync(0, "utf8").replace(/\r?\n$/, "");
}

/** Returns the default resolver, one DoH resolver, or several combined as in 9.2. */
function resolverFrom(urls: string[] | undefined): Resolver {
  if (!urls || urls.length === 0) return defaultResolver();
  return urls.length === 1 ? dohResolver(urls[0]!) : combineResolvers(...urls.map((url) => dohResolver(url)));
}

function print(line = ""): void {
  process.stdout.write(line + "\n");
}

// ---- Commands ---------------------------------------------------------------------------------

function keygen(args: string[]): number {
  const { values } = parse(args, { out: { type: "string" } });
  const out = required(values.out, "out");
  const { privateKey, publicKey } = generateKey();
  writeFileSync(out, privateKey, { mode: 0o600, flag: "wx" });
  print(formatKeyRecord(publicKey));
  return EXIT_OK;
}

async function record(args: string[]): Promise<number> {
  const { values } = parse(args, {
    key: { type: "string" },
    domain: { type: "string" },
    "key-id": { type: "string" },
    check: { type: "boolean" },
    revoke: { type: "boolean" },
    resolver: { type: "string", multiple: true },
  });
  const domain = toAsciiDomain(required(values.domain, "domain"));
  const keyId = required(values["key-id"], "key-id");
  checkKeyId(keyId);
  const name = lookupName(keyId, domain);
  if (values.revoke && values.key) throw new UsageError("--revoke and --key cannot be combined.");
  const text = formatKeyRecord(values.revoke ? null : publicKeyOf(readFileSync(required(values.key, "key"), "utf8")));
  print(`${name}. TXT "${text}"`);
  if (!values.check) return EXIT_OK;

  const answer = await safeResolve(resolverFrom(values.resolver), name);
  if (answer.result === "failure") {
    print(`No DNS answer was obtained for ${name}.`);
    return EXIT_UNAVAILABLE;
  }
  const published = answer.result === "answer" ? selectKeyRecord(answer.txt) : null;
  const expected = selectKeyRecord([[text]])!;
  const matches = published !== null && published.k === expected.k && published.p === expected.p;
  print(matches ? `The published record matches.` : published ? `The published record differs: ${published.text}` : `No usable record is published at ${name}.`);
  return matches ? EXIT_OK : EXIT_NOT_VALID;
}

function readFields(values: { field?: string[]; fields?: string }): [string, string][] {
  if (values.field && values.fields) throw new UsageError("--field and --fields cannot be combined.");
  if (values.fields) {
    try {
      return JSON.parse(readFileSync(values.fields, "utf8")) as [string, string][];
    } catch (e) {
      if (e instanceof SyntaxError) throw new UsageError(`${values.fields} is not valid JSON.`);
      throw e;
    }
  }
  if (!values.field) throw new UsageError("Fields are required: --field <name>=<value> or --fields <file.json>.");
  return values.field.map((f) => {
    const eq = f.indexOf("=");
    if (eq < 1) throw new UsageError(`The field "${f}" is not of the form <name>=<value>.`);
    return [f.slice(0, eq), f.slice(eq + 1)];
  });
}

async function create(args: string[]): Promise<number> {
  const { values } = parse(args, {
    key: { type: "string" },
    domain: { type: "string" },
    "key-id": { type: "string" },
    field: { type: "string", multiple: true },
    fields: { type: "string" },
    "issued-at": { type: "string" },
    svg: { type: "string" },
  });
  const domain = required(values.domain, "domain");
  const keyId = required(values["key-id"], "key-id");
  const keyFile = required(values.key, "key");
  const issuedAt = values["issued-at"] ? { issuedAt: parseTime(values["issued-at"]) } : {};
  const fields = readFields(values);
  const stamp = await createStamp({ domain, keyId, privateKey: readFileSync(keyFile, "utf8"), fields, ...issuedAt });
  if (values.svg) writeFileSync(values.svg, stamp.svg);
  print(stamp.text);
  return EXIT_OK;
}

function printResult(result: VerifyResult): void {
  const rows: [string, string][] = [["Outcome", result.outcome]];
  if (result.outcome === "valid") {
    const domain = result.domainUnicode === result.domain ? result.domain! : `${result.domainUnicode} (${result.domain})`;
    rows.push(["Domain", domain], ["Issued", formatTime(result.issuedAt!)], ["DNSSEC", result.dnssec ? "validated" : "not validated"]);
  } else {
    rows.push(["Reason", result.reason]);
  }
  for (const w of result.warnings) rows.push(["Warning", w.message]);
  for (const [label, value] of rows) print(`${label.padEnd(10)}${value}`);
  if (result.outcome !== "valid" || !result.fields) return;

  print();
  print(`Stated by ${result.domainUnicode}`);
  const width = Math.max(...result.fields.map(([name]) => [...name].length));
  for (const [name, value] of result.fields) print(`  ${name}${" ".repeat(width - [...name].length)}  ${value}`);
}

async function verify(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { json: { type: "boolean" }, resolver: { type: "string", multiple: true }, now: { type: "string" } }, 1);
  const result = await verifyStamp(readStamp(positionals[0]), {
    resolve: resolverFrom(values.resolver),
    ...(values.now ? { now: parseTime(values.now) } : {}),
  });
  if (values.json) print(JSON.stringify(result, null, 2));
  else printResult(result);
  return result.outcome === "valid" ? EXIT_OK : result.outcome === "unavailable" ? EXIT_UNAVAILABLE : EXIT_NOT_VALID;
}

function inspect(args: string[]): number {
  const { values, positionals } = parse(args, { json: { type: "boolean" } }, 1);
  const result = inspectStamp(readStamp(positionals[0]));
  if (values.json) {
    print(JSON.stringify(result, null, 2));
  } else if (result.parsed) {
    const domain = result.domainUnicode === result.domain ? result.domain : `${result.domainUnicode} (${result.domain})`;
    const rows = [["Domain", domain], ["Key ID", result.keyId], ["Issued", formatTime(result.issuedAt)], ["Lookup", result.lookupName], ["Size", `${result.sizes.envelope} bytes, ${result.sizes.text} characters`]];
    for (const [label, value] of rows) print(`${label!.padEnd(10)}${value}`);
    print("The stamp has not been verified.");
  } else {
    print(`${"Outcome".padEnd(10)}${result.outcome}`);
    print(`${"Reason".padEnd(10)}${result.reason}`);
  }
  return result.parsed ? EXIT_OK : EXIT_NOT_VALID;
}

function serve(args: string[]): Promise<number> {
  const { values } = parse(args, {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "8445" },
    key: { type: "string" },
    domain: { type: "string" },
    "key-id": { type: "string" },
    resolver: { type: "string", multiple: true },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError("--port must be a port number.");
  let signing;
  if (values.key) {
    const token = process.env.DKDS_TOKEN ?? randomBytes(24).toString("base64url");
    signing = {
      domain: toAsciiDomain(required(values.domain, "domain")),
      keyId: required(values["key-id"], "key-id"),
      privateKey: readFileSync(values.key, "utf8"),
      token,
    };
    publicKeyOf(signing.privateKey);
    if (!process.env.DKDS_TOKEN) process.stderr.write(`Token for /create: ${token}\n`);
  }
  const server = createApiServer({ ...(signing ? { signing } : {}), resolve: resolverFrom(values.resolver) });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, values.host, () => {
      const address = server.address() as { address: string; port: number };
      process.stderr.write(`Listening on http://${address.address.includes(":") ? `[${address.address}]` : address.address}:${address.port}\n`);
      process.once("SIGINT", () => server.close(() => resolve(EXIT_OK)));
      process.once("SIGTERM", () => server.close(() => resolve(EXIT_OK)));
    });
  });
}

const COMMANDS: Record<string, (args: string[]) => number | Promise<number>> = { keygen, record, create, verify, inspect, serve };

/** Runs the command line and returns the exit status. */
export async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command === "--version") {
    print(PACKAGE_VERSION);
    return EXIT_OK;
  }
  if (command === undefined || command === "--help" || command === "help") {
    process.stdout.write(USAGE);
    return command === undefined ? EXIT_USAGE : EXIT_OK;
  }
  const run = COMMANDS[command];
  if (!run) {
    process.stderr.write(`Unknown command "${command}".\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  try {
    return await run(args);
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`${e.message}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (e instanceof DkdsError) {
      process.stderr.write(`${e.message} [${e.code}]\n`);
      return EXIT_NOT_VALID;
    }
    if (e instanceof Error && "code" in e && typeof e.code === "string" && e.code.startsWith("E")) {
      process.stderr.write(`${e.message}\n`);
      return EXIT_NOT_VALID;
    }
    throw e;
  }
}
