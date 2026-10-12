/**
 * A resolver that uses the DNS configuration of the operating system.
 */

import { Resolver as NodeResolver } from "node:dns/promises";
import type { Resolver } from "../discovery/resolver.ts";

/**
 * Returns a resolver that queries the servers configured in the operating system. The operating system
 * does not report DNSSEC validation, so every answer has `dnssec: false`.
 *
 * @param servers Server addresses to query instead of the configured ones.
 */
export function systemResolver(servers?: readonly string[]): Resolver {
  if (servers) new NodeResolver().setServers([...servers]);
  return async (name, options) => {
    const resolver = new NodeResolver();
    if (servers) resolver.setServers([...servers]);
    const abort = () => resolver.cancel();
    options?.signal?.addEventListener("abort", abort, { once: true });
    try {
      return { result: "answer", txt: await resolver.resolveTxt(name), dnssec: false };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ENOTFOUND") return { result: "nxdomain" };
      if (code === "ENODATA") return { result: "answer", txt: [], dnssec: false };
      return { result: "failure", reason: `The system resolver failed${code ? ` (${code})` : ""}.` };
    } finally {
      options?.signal?.removeEventListener("abort", abort);
    }
  };
}
