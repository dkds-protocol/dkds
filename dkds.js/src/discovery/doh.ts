/**
 * DNS over HTTPS (RFC 8484) and the default resolvers.
 */

import { base64UrlEncode } from "../bytes.ts";
import { encodeTxtQuery, parseTxtResponse } from "./message.ts";
import { combineResolvers, type Resolver } from "./resolver.ts";

/** Options of {@link dohResolver}. */
export interface DohOptions {
  /** Time limit for one query, in milliseconds. Default: 5000. */
  readonly timeout?: number;
  /** The `fetch` function to use. Default: the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

const MEDIA_TYPE = "application/dns-message";
const MAX_RESPONSE_BYTES = 65535;

/**
 * Returns a resolver that queries a DNS over HTTPS server with the GET method (RFC 8484, 4.1). GET
 * requests with only an `Accept` header need no CORS preflight in browsers.
 *
 * @param url The URL of the server's DNS endpoint, for example `https://cloudflare-dns.com/dns-query`.
 */
export function dohResolver(url: string, options: DohOptions = {}): Resolver {
  const endpoint = new URL(url);
  const timeout = options.timeout ?? 5000;
  return async (name, resolveOptions) => {
    const fetchFn = options.fetch ?? globalThis.fetch;
    const request = new URL(endpoint);
    request.searchParams.set("dns", base64UrlEncode(encodeTxtQuery(name)));
    const timeoutSignal = AbortSignal.timeout(timeout);
    const signal = resolveOptions?.signal ? AbortSignal.any([timeoutSignal, resolveOptions.signal]) : timeoutSignal;
    let body: Uint8Array;
    try {
      const response = await fetchFn(request, { headers: { accept: MEDIA_TYPE }, signal, redirect: "error" });
      if (response.status !== 200) return { result: "failure", reason: `${endpoint.host} returned HTTP status ${response.status}.` };
      if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith(MEDIA_TYPE)) {
        return { result: "failure", reason: `${endpoint.host} returned a response that is not a DNS message.` };
      }
      if (Number(response.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES) {
        return { result: "failure", reason: `${endpoint.host} returned an oversized response.` };
      }
      body = new Uint8Array(await response.arrayBuffer());
    } catch (e) {
      return { result: "failure", reason: `${endpoint.host} could not be reached: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (body.length > MAX_RESPONSE_BYTES) return { result: "failure", reason: `${endpoint.host} returned an oversized response.` };
    return parseTxtResponse(body, name);
  };
}

/** The DNS over HTTPS servers queried by default. Both validate DNSSEC and allow cross-origin requests. */
export const DEFAULT_DOH_SERVERS: readonly string[] = Object.freeze([
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/dns-query",
]);

/** Returns the default resolver: the servers of {@link DEFAULT_DOH_SERVERS}, combined as in 9.2. */
export function defaultResolver(options: DohOptions = {}): Resolver {
  return combineResolvers(...DEFAULT_DOH_SERVERS.map((url) => dohResolver(url, options)));
}
