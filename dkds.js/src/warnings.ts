/**
 * Warnings about a verified domain (specification 9.2 and 9.3). Warnings never change the outcome.
 */

/** Warning codes. Each code is stable across releases of the same major version. */
export type WarningCode = "idn" | "mixed-script" | "single-resolver" | "key-changed" | "key-disappeared" | "similar-domain";

/** A warning for the reader. */
export interface Warning {
  readonly code: WarningCode;
  readonly message: string;
}

/**
 * Remembers the key records seen for lookup names, for the warnings of 9.2. Implementations may be
 * synchronous or asynchronous.
 */
export interface KeyStore {
  /** Returns the record last stored for a lookup name. */
  get(lookupName: string): string | undefined | Promise<string | undefined>;
  /** Stores the record of a lookup name, and the domain in Unicode form, after a valid verification. */
  set(lookupName: string, record: string, domainUnicode: string): void | Promise<void>;
  /** Returns the domains, in Unicode form, passed to `set`. */
  domains?(): Iterable<string> | Promise<Iterable<string>>;
}

/**
 * Scripts detected in domain labels. Characters of the scripts Common and Inherited, such as digits and
 * the hyphen, belong to no script here. Letters of a script not listed are counted as one further script.
 */
const SCRIPTS = [
  "Latin", "Greek", "Cyrillic", "Armenian", "Hebrew", "Arabic", "Syriac", "Thaana", "Nko", "Devanagari",
  "Bengali", "Gurmukhi", "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada", "Malayalam", "Sinhala", "Thai",
  "Lao", "Tibetan", "Myanmar", "Georgian", "Hangul", "Ethiopic", "Cherokee", "Khmer", "Mongolian",
  "Hiragana", "Katakana", "Bopomofo", "Han", "Tifinagh", "Coptic",
].map((name) => ({ name, pattern: new RegExp(`^\\p{Script=${name}}$`, "u") }));
const NO_SCRIPT = /^[\p{Script=Common}\p{Script=Inherited}]$/u;

/**
 * Combinations of scripts that are not reported as mixed: the "Highly Restrictive" level of Unicode
 * Technical Standard #39, section 5.2.
 */
const ALLOWED_COMBINATIONS = [
  ["Latin", "Han", "Hiragana", "Katakana"],
  ["Latin", "Han", "Bopomofo"],
  ["Latin", "Han", "Hangul"],
];

function scriptsOf(label: string): Set<string> {
  const scripts = new Set<string>();
  for (const ch of label) {
    if (NO_SCRIPT.test(ch)) continue;
    scripts.add(SCRIPTS.find((s) => s.pattern.test(ch))?.name ?? "Other");
  }
  return scripts;
}

function isMixed(scripts: Set<string>): boolean {
  if (scripts.size <= 1) return false;
  return !ALLOWED_COMBINATIONS.some((allowed) => [...scripts].every((s) => allowed.includes(s)));
}

/** Returns the warnings that follow from the domain alone: `idn` and `mixed-script`. */
export function domainWarnings(domain: string, domainUnicode: string): Warning[] {
  const warnings: Warning[] = [];
  if (domain !== domainUnicode) {
    warnings.push({ code: "idn", message: `The domain contains internationalised labels. Its ASCII form is ${domain}.` });
  }
  for (const label of domainUnicode.split(".")) {
    const scripts = scriptsOf(label);
    if (isMixed(scripts)) {
      warnings.push({ code: "mixed-script", message: `The label "${label}" mixes the scripts ${[...scripts].join(", ")}.` });
    }
  }
  return warnings;
}

/** A simplified form of a domain in which commonly confused characters are equal. */
function skeleton(domain: string): string {
  return domain.replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/[1i]/g, "l").replace(/-/g, "");
}

/** Returns true when two strings differ by one insertion, deletion, substitution or adjacent transposition. */
function withinOneEdit(a: string, b: string): boolean {
  const x = [...a];
  const y = [...b];
  if (Math.abs(x.length - y.length) > 1) return false;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  const rest = (p: number, q: number) => x.slice(p).join("") === y.slice(q).join("");
  if (x.length === y.length) {
    return rest(i + 1, i + 1) || (x[i] === y[i + 1] && x[i + 1] === y[i] && rest(i + 2, i + 2));
  }
  return x.length > y.length ? rest(i + 1, i) : rest(i, i + 1);
}

/**
 * Returns the domains of `known` that resemble `domain` without being equal to it: they differ by one
 * edit, or they are equal after the substitutions `rn`/`m`, `vv`/`w`, `0`/`o`, `1`/`i`/`l` and the
 * removal of hyphens.
 */
export function similarDomains(domain: string, known: Iterable<string>): string[] {
  const result: string[] = [];
  for (const other of known) {
    if (other === domain) continue;
    if (withinOneEdit(domain, other) || skeleton(domain) === skeleton(other)) result.push(other);
  }
  return result;
}
