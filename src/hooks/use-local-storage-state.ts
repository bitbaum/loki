"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * May the state be written to `key` yet? Only once the stored value FOR THAT
 * KEY has been read. The hook used to remember a single "initialized" flag, so
 * when the key changed after mount (the terminal's per-builder keys switch from
 * cloud to local once the saved source resolves) the previous key's value was
 * written over the new key's stored one — a reload silently reset the tab
 * layout and names, and the cloud value leaked into the local key.
 */
export function canPersist(hydratedKey: string | null, key: string): boolean {
  return hydratedKey === key;
}

/** What `key` holds, or `fallback` when it holds nothing or cannot be read. A
 *  key with nothing stored must read as the default — not as whatever the
 *  previous key held. */
export function readStored<T>(
  storage: Pick<Storage, "getItem">,
  key: string,
  deserialize: (raw: string) => T,
  fallback: T,
): T {
  try {
    const raw = storage.getItem(key);
    return raw === null ? fallback : deserialize(raw);
  } catch {
    return fallback;
  }
}

/**
 * SSR-safe localStorage state hook. Defers hydration to a client-side effect
 * so the server-rendered default never overwrites stored values on first mount.
 * Re-hydrates when `key` changes. Syncs changes across windows via the
 * `storage` event.
 */
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  serialize: (v: T) => string,
  deserialize: (raw: string) => T,
  /** `session`: this window's own storage, kept across its reloads and
   *  never shared with another window — for state that IS a window's (the
   *  workbench's panes). The default is the device's. */
  area: "local" | "session" = "local",
): [T, (updater: T | ((prev: T) => T)) => void] {
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [value, setValue] = useState<T>(defaultValue);
  const store = () => (area === "session" ? sessionStorage : localStorage);

  // Hydrate from storage on mount and whenever the key changes (client-only).
  // `area` is fixed per call site, so the key alone decides a re-read.
  useEffect(() => {
    setValue(readStored(store(), key, deserialize, defaultValue)); // eslint-disable-line react-hooks/set-state-in-effect
    setHydratedKey(key);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Write to storage only after this key's hydration read.
  // Guard: skip write if the stored value already matches — prevents ping-pong
  // between windows when storage events cause each window to re-write the same value.
  useEffect(() => {
    if (!canPersist(hydratedKey, key)) return;
    try {
      const serialized = serialize(value);
      if (store().getItem(key) !== serialized) {
        store().setItem(key, serialized);
      }
    } catch {
      /* ignore */
    }
  }, [hydratedKey, value, key, serialize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync changes from other windows (the device's storage; a window's own
  // storage has no other window to hear from).
  useEffect(() => {
    if (area === "session") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      try {
        setValue(e.newValue !== null ? deserialize(e.newValue) : defaultValue);
      } catch {
        /* ignore malformed */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, area, defaultValue, deserialize]);

  const set = useCallback((updater: T | ((prev: T) => T)) => {
    setValue(updater as Parameters<typeof setValue>[0]);
  }, []);

  return [value, set];
}
