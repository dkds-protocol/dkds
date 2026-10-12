/**
 * The language of the verifier and its texts. English is the source language; each
 * other language is a module in i18n/ of the type {@link Texts}, so that a text missing from a
 * language, or one it has in addition, is a type error.
 *
 * English is part of the application. Each other language is a separate file, fetched when it is
 * chosen and kept by the service worker for use offline, so that a language adds nothing to the
 * start of the application in another.
 *
 * The language is, in order: the parameter `lang` of the address, the choice stored on this device,
 * the first of the browser's preferred languages that the verifier has, and English.
 */

import { en, type Texts } from "./i18n/en.ts";

export type { Texts } from "./i18n/en.ts";
export type { Sentence } from "./i18n/grammar.ts";

/** A language of the verifier: its tag, its name in that language, and its texts. */
export interface Language {
  readonly code: string;
  readonly name: string;
  /** The texts; rejects when the file of the language cannot be fetched. */
  load(): Promise<Texts>;
}

/** Every language of the verifier, English first, in the order of the language menu. */
export const LANGUAGES: readonly Language[] = [
  { code: "en", name: "English", load: async () => en },
  { code: "nl", name: "Nederlands", load: async () => (await import("./i18n/nl.ts")).nl },
  { code: "fr", name: "Français", load: async () => (await import("./i18n/fr.ts")).fr },
  { code: "de", name: "Deutsch", load: async () => (await import("./i18n/de.ts")).de },
  { code: "es", name: "Español", load: async () => (await import("./i18n/es.ts")).es },
  { code: "it", name: "Italiano", load: async () => (await import("./i18n/it.ts")).it },
];

/** The outcome descriptions in English, for the documentation page "Building a verifier". */
export const OUTCOMES = en.outcomes;

/** The texts of the current language. */
export let T: Texts = en;

const STORE = "dkds-language";

const find = (code: string | null | undefined) => LANGUAGES.find((l) => l.code === code?.toLowerCase().split("-")[0]);

/** The language to start in; see the module description. */
export function initialLanguage(): Language {
  const param = new URLSearchParams(location.search).get("lang");
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORE);
  } catch {
    // Without local storage the choice lasts for the page.
  }
  return find(param) ?? find(stored) ?? navigator.languages.map(find).find((l) => l !== undefined) ?? LANGUAGES[0]!;
}

/** Makes `texts` the current language and, where `remember` is set, stores the choice on this device. */
export function setLanguage(texts: Texts, remember = false): void {
  T = texts;
  document.documentElement.lang = texts.code;
  if (!remember) return;
  try {
    localStorage.setItem(STORE, texts.code);
  } catch {
    // Without local storage the choice lasts for the page.
  }
}
