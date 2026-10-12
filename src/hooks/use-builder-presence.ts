"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getJson } from "@/lib/api/fetch";

export type BuilderPresenceSnapshot = {
  runnerConnected: boolean | null;
  runtimeAvailable: boolean;
  builderPresence: { cloud: boolean; local: boolean; any: boolean } | null;
  /**
   * May this account use the shared cloud builder? null until the first poll
   * lands. The fact every "connect Fleet Runner" offer has to check first: for
   * an account that has the cloud, a download is never the way forward.
   */
  cloudBuilderAllowed: boolean | null;
};

const EMPTY: BuilderPresenceSnapshot = {
  runnerConnected: null,
  runtimeAvailable: false,
  builderPresence: null,
  cloudBuilderAllowed: null,
};

const POLL_MS = 15_000;
const STALE_MS = 5_000;

/**
 * One poller, however many readers.
 *
 * This used to be a per-component interval. Each caller fetched
 * /api/builder/presence on its own timer, so /terminal hit it twice per tick
 * for one page, and a surface that wanted presence inside a list — the card
 * under every dispatch in a Loki thread — could not have it without mounting
 * a poller per message. Module state, refcounted: the first subscriber starts
 * the interval, the last one stops it, and every reader sees the same object.
 */
let snapshot: BuilderPresenceSnapshot = EMPTY;
let loadedAt = 0;
let subscribers = 0;
let timer: number | null = null;
const listeners = new Set<() => void>();

async function load(): Promise<void> {
  try {
    const data = await getJson<{
      runnerConnected?: boolean | null;
      runtimeAvailable?: boolean;
      builderPresence?: { cloud: boolean; local: boolean; any: boolean } | null;
      cloudBuilderAllowed?: boolean | null;
    }>("/api/builder/presence");
    snapshot = {
      runnerConnected: data.runnerConnected ?? data.builderPresence?.any ?? null,
      runtimeAvailable: data.runtimeAvailable === true,
      builderPresence: data.builderPresence ?? null,
      cloudBuilderAllowed:
        typeof data.cloudBuilderAllowed === "boolean" ? data.cloudBuilderAllowed : null,
    };
  } catch {
    snapshot = EMPTY;
  }
  loadedAt = Date.now();
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  if (subscribers++ === 0) {
    void load();
    timer = window.setInterval(() => void load(), POLL_MS);
  }
  return () => {
    listeners.delete(notify);
    if (--subscribers === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => EMPTY;

/** Lightweight shared poll for executor honesty chips (Control, Loki, Terminal). */
export function useBuilderPresence(): BuilderPresenceSnapshot {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // A reader mounting onto an already-running poller gets the cached
  // snapshot first and a fresh one right behind it — unless the cache is
  // seconds old, so a thread of twenty dispatch cards mounting at once does
  // not fire twenty fetches.
  useEffect(() => {
    if (subscribers > 1 && Date.now() - loadedAt > STALE_MS) void load();
  }, []);
  return current;
}
