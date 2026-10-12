/**
 * The key store: the key records seen for lookup names, kept in the browser's local
 * storage, for the warnings `key-changed`, `key-disappeared` and `similar-domain` (specification 9.2,
 * 9.3). It holds lookup names, key records and domains, never fields. When local storage is not
 * available, as in some private browsing modes, the store lasts for the session only.
 */

import type { KeyStore } from "../../dkds.js/src/index.ts";

const STORAGE_KEY = "dkds-scan.keys.v1";

interface Entry {
  readonly record: string;
  readonly domain: string;
}

/** A key store that can also count and forget its entries. */
export interface LocalKeyStore extends KeyStore {
  /** The number of distinct domains stored. */
  count(): number;
  /** Removes every entry. */
  clear(): void;
}

function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && typeof (value as Entry).record === "string" && typeof (value as Entry).domain === "string";
}

/** Opens the key store. */
export function openKeyStore(): LocalKeyStore {
  /** The entries, when local storage cannot be used. */
  let memory: Record<string, Entry> | undefined;

  const load = (): Record<string, Entry> => {
    if (memory) return memory;
    let raw: string | null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return (memory = {});
    }
    const entries: Record<string, Entry> = {};
    try {
      const parsed: unknown = JSON.parse(raw ?? "{}");
      if (typeof parsed === "object" && parsed !== null) {
        for (const [name, entry] of Object.entries(parsed)) if (isEntry(entry)) entries[name] = entry;
      }
    } catch {
      // A damaged entry is discarded.
    }
    return entries;
  };

  const save = (entries: Record<string, Entry>) => {
    if (memory) {
      memory = entries;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Local storage is full or was disabled; the entries are kept in memory for this session.
      memory = entries;
    }
  };

  return {
    get: (lookupName) => load()[lookupName]?.record,
    set: (lookupName, record, domain) => save({ ...load(), [lookupName]: { record, domain } }),
    domains: () => new Set(Object.values(load()).map((e) => e.domain)),
    count: () => new Set(Object.values(load()).map((e) => e.domain)).size,
    clear: () => {
      if (memory) memory = {};
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing is stored when local storage is unavailable.
      }
    },
  };
}
