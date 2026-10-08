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
): [T, (updater: T | ((prev: T) => T)) => void] {
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [value, setValue] = useState<T>(defaultValue);

  // Hydrate from localStorage on mount and whenever the key changes (client-only).
  useEffect(() => {
    setValue(readStored(localStorage, key, deserialize, defaultValue)); // eslint-disable-line react-hooks/set-state-in-effect
    setHydratedKey(key);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Write to localStorage only after this key's hydration read.
  // Guard: skip write if the stored value already matches — prevents ping-pong
  // between windows when storage events cause each window to re-write the same value.
  useEffect(() => {
    if (!canPersist(hydratedKey, key)) return;
    try {
      const serialized = serialize(value);
      if (localStorage.getItem(key) !== serialized) {
        localStorage.setItem(key, serialized);
      }
    } catch {
      /* ignore */
    }
  }, [hydratedKey, value, key, serialize]);

  // Sync changes from other windows.
  useEffect(() => {
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
  }, [key, defaultValue, deserialize]);

  const set = useCallback((updater: T | ((prev: T) => T)) => {
    setValue(updater as Parameters<typeof setValue>[0]);
  }, []);

  return [value, set];
}
