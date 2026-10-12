/**
 * Plurals and lists in the rules of each language, from the Intl objects of the browser.
 */

/** A sentence in parts; a part `{ domain }` is a domain name, set apart from the text. */
export type Sentence = readonly (string | { readonly domain: string })[];

/** The singular and plural forms of a word or phrase. */
export interface Forms {
  readonly one: string;
  readonly other: string;
}

/** Selects the form for `n` by the plural rules of `locale` (in French, 0 and 1 are singular). */
export function form(locale: string, n: number, forms: Forms): string {
  return new Intl.PluralRules(locale).select(n) === "one" ? forms.one : forms.other;
}

/** `n` followed by the form that agrees with it, as "1 page" or "3 pages". */
export function count(locale: string, n: number, forms: Forms): string {
  return `${n} ${form(locale, n, forms)}`;
}

/** Joins items as a list in `locale`: "a, b and c" in English. */
export function list(locale: string, items: readonly string[]): string {
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
}

/** Joins domain names as a list in `locale`, each name set apart as a part `{ domain }`. */
export function domainList(locale: string, names: readonly string[]): Sentence {
  return new Intl.ListFormat(locale, { type: "conjunction" })
    .formatToParts(names)
    .map((part) => (part.type === "element" ? { domain: part.value } : part.value));
}
