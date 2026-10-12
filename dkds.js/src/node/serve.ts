/**
 * The local HTTP API.
 *
 * | Method and path | Request body                            | Response body             |
 * |-----------------|-----------------------------------------|---------------------------|
 * | `GET /`         |                                         | `{ dkds, version }`       |
 * | `POST /verify`  | `{ "text": string }`                    | the result of verifyStamp |
 * | `POST /create`  | `{ "fields": [[n, v], ...], "issuedAt"? }` | `{ "text", "svg" }`    |
 *
 * Requests are refused when they carry an `Origin` header (requests from web pages), when the `Host`
 * header names another host (DNS rebinding), when a body is not `application/json` or exceeds 64 KB, and,
 * for `/create`, when the bearer token is missing or wrong.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createStamp } from "../create.ts";
import type { Resolver } from "../discovery/resolver.ts";
import { DkdsError } from "../errors.ts";
import { publicKeyOf, type PrivateKey, type Signer } from "../keys.ts";
import { verifyStamp } from "../verify.ts";
import { PACKAGE_VERSION } from "./version.ts";

/** The key with which `/create` signs. */
export interface ApiSigningKey {
  readonly domain: string;
  readonly keyId: string;
  readonly privateKey?: PrivateKey;
  readonly signer?: Signer;
  /** The bearer token that `/create` requires. */
  readonly token: string;
}

/** Options of {@link createApiServer}. */
export interface ApiOptions {
  /** The key for `/create`. Without it, `/create` responds with 404. */
  readonly signing?: ApiSigningKey;
  /** The resolver for `/verify`. Default: the default resolver of `verifyStamp`. */
  readonly resolve?: Resolver;
}

const MAX_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(json);
}

/** Returns the `Host` header values under which the server may be addressed. */
function allowedHosts(server: Server): Set<string> {
  const { address, port } = server.address() as AddressInfo;
  const hosts = new Set([`${address}:${port}`, `[${address}]:${port}`]);
  if (address === "127.0.0.1" || address === "::1") {
    for (const h of ["localhost", "127.0.0.1", "[::1]"]) hosts.add(`${h}:${port}`);
  }
  return hosts;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "unsupported-media-type", "The request body must be application/json.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body-too-large", "The request body exceeds 64 KB.");
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid-json", "The request body is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "invalid-request", "The request body must be a JSON object.");
  return body as Record<string, unknown>;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(/^Bearer (.+)$/.exec(header ?? "")?.[1] ?? "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Creates the HTTP server of the local API. The caller starts it with `listen`; the API should listen
 * on a loopback address. Throws `invalid-argument` for a token shorter than 16 characters and
 * `key-invalid` for an invalid private key.
 */
export function createApiServer(options: ApiOptions = {}): Server {
  const { signing, resolve } = options;
  if (signing && !(typeof signing.token === "string" && signing.token.length >= 16)) {
    throw new DkdsError("invalid-argument", "The API token must be a string of at least 16 characters.");
  }
  if (signing?.privateKey !== undefined) publicKeyOf(signing.privateKey);

  const server = createServer(async (req, res) => {
    try {
      if (!allowedHosts(server).has(req.headers.host ?? "")) throw new HttpError(421, "host-not-allowed", "The Host header does not name this server.");
      if (req.headers.origin !== undefined) throw new HttpError(403, "origin-not-allowed", "Requests from web pages are not accepted.");
      const path = new URL(req.url ?? "/", "http://localhost").pathname;

      if (path === "/" && req.method === "GET") return send(res, 200, { dkds: "1", version: PACKAGE_VERSION });

      if (path === "/verify") {
        if (req.method !== "POST") throw new HttpError(405, "method-not-allowed", "Use POST.");
        const body = await readJson(req);
        if (typeof body.text !== "string") throw new HttpError(400, "invalid-request", "text must be a string.");
        const result = await verifyStamp(body.text, resolve ? { resolve } : {});
        return send(res, 200, result);
      }

      if (path === "/create" && signing) {
        if (req.method !== "POST") throw new HttpError(405, "method-not-allowed", "Use POST.");
        if (!tokenMatches(req.headers.authorization, signing.token)) throw new HttpError(401, "unauthorized", "A valid bearer token is required.");
        const body = await readJson(req);
        const { token: _token, ...key } = signing;
        const issuedAt = body.issuedAt === undefined ? {} : { issuedAt: body.issuedAt as number };
        const stamp = await createStamp({ ...key, ...issuedAt, fields: body.fields as never });
        return send(res, 200, { text: stamp.text, svg: stamp.svg });
      }

      throw new HttpError(404, "not-found", "No such endpoint.");
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message } });
      if (e instanceof DkdsError) return send(res, 422, { error: { code: e.code, message: e.message } });
      send(res, 500, { error: { code: "internal-error", message: "The request could not be processed." } });
    }
  });
  return server;
}
