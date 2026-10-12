/**
 * The resolver interface and the combination of independent resolvers (specification 8.2 step 6, 9.2).
 */

/** The answer of a resolver for the TXT records at one name. */
export type DnsAnswer =
  | {
      readonly result: "answer";
      /** The TXT records at the name, each as its list of character strings. */
      readonly txt: readonly (readonly string[])[];
      /** Whether the answer was validated with DNSSEC. */
      readonly dnssec: boolean;
      /** The number of resolvers that gave this answer, when several were queried. */
      readonly resolvers?: number;
    }
  | {
      /** The name does not exist. */
      readonly result: "nxdomain";
      readonly resolvers?: number;
    }
  | {
      /**
       * No answer was obtained: a timeout, a server failure, a DNSSEC validation failure, a malformed
       * response, or resolvers that disagree.
       */
      readonly result: "failure";
      readonly reason?: string;
    };

/** Options passed to a resolver for one query. */
export interface ResolveOptions {
  readonly signal?: AbortSignal;
}

/**
 * Looks up the TXT records at a name. CNAME records are followed. A resolver reports every problem as
 * a `failure` answer; a resolver that throws is treated as having returned `failure`.
 */
export type Resolver = (name: string, options?: ResolveOptions) => Promise<DnsAnswer>;

/** Calls a resolver and converts an exception or an invalid return value to a `failure` answer. */
export async function safeResolve(resolver: Resolver, name: string, options?: ResolveOptions): Promise<DnsAnswer> {
  try {
    const answer = await resolver(name, options);
    return isDnsAnswer(answer) ? answer : { result: "failure", reason: "The resolver returned an invalid answer." };
  } catch (e) {
    return { result: "failure", reason: e instanceof Error ? e.message : "The resolver failed." };
  }
}

function isDnsAnswer(value: unknown): value is DnsAnswer {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  if (a.result === "nxdomain" || a.result === "failure") return true;
  return (
    a.result === "answer" &&
    typeof a.dnssec === "boolean" &&
    Array.isArray(a.txt) &&
    a.txt.every((r) => Array.isArray(r) && r.every((s) => typeof s === "string"))
  );
}

/**
 * A representation of an answer's content (9.2): each record with its character strings joined, in an
 * order that does not depend on the order of the records.
 */
function contentKey(answer: DnsAnswer): string {
  if (answer.result !== "answer") return answer.result;
  return JSON.stringify(answer.txt.map((record) => record.join("")).sort());
}

/**
 * Combines independent resolvers as described in 9.2. All resolvers are queried in parallel.
 *
 * - When every resolver that answers gives the same content, that answer is returned with the number of
 *   resolvers that answered; it counts as validated with DNSSEC only if every one of them validated it.
 * - When two resolvers give different content, the result is `failure`. A name reported as not existing
 *   by one resolver and as existing by another is a difference.
 * - When no resolver answers, the result is `failure`.
 *
 * Records are compared with their character strings joined, regardless of their order.
 */
export function combineResolvers(...resolvers: readonly Resolver[]): Resolver {
  if (resolvers.length === 0) throw new TypeError("combineResolvers requires at least one resolver.");
  return async (name, options) => {
    const answers = await Promise.all(resolvers.map((r) => safeResolve(r, name, options)));
    const answered = answers.filter((a) => a.result !== "failure");
    const first = answered[0];
    if (first === undefined) return { result: "failure", reason: "No resolver answered." };
    if (answered.some((a) => contentKey(a) !== contentKey(first))) {
      return { result: "failure", reason: "The resolvers gave different answers (9.2)." };
    }
    if (first.result === "nxdomain") return { result: "nxdomain", resolvers: answered.length };
    if (first.result !== "answer") return first;
    const dnssec = answered.every((a) => a.result === "answer" && a.dnssec);
    return { result: "answer", txt: first.txt, dnssec, resolvers: answered.length };
  };
}
