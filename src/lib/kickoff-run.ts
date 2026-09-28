"use client";

/**
 * The page's view of a "Make it happen" run. The server does the work.
 *
 * History, because each step fixed the last one's blind spot:
 *   1. The run lived in ProjectKickoff's useState — leaving the page to watch
 *      Terminal unmounted the card and coming back showed a fresh button.
 *   2. It moved to a module store here, which survived in-app navigation but
 *      still DROVE the steps from the browser — and a phone suspends a tab the
 *      moment the screen locks, stopping the setup halfway.
 *   3. Now the server runs it (lib/kickoff/server-runs) and this module only
 *      starts it and watches: a locked phone, a closed tab, a second device
 *      all see the same live run, and the steps keep going regardless.
 *
 * Every surface that cares (the kickoff card, the Terminal's empty state)
 * subscribes to the same store. The last snapshot is mirrored to
 * sessionStorage so a reload paints instantly, then the server is asked what
 * is actually true.
 */

import { useEffect, useSyncExternalStore } from "react";
import { postJson } from "@/lib/api/fetch";
import type { KickoffStepId } from "@/lib/project-kickoff";
import {
  initialKickoffRun,
  type KickoffRunState,
  type KickoffStepRun,
  type KickoffStepState,
  type KickoffDispatchOutcome,
} from "@/lib/kickoff/orchestrate";

export type KickoffRun = KickoffRunState;
export type { KickoffStepRun, KickoffStepState, KickoffDispatchOutcome };

const STORAGE_PREFIX = "loki:kickoff:";
const POLL_MS = 1500;
const runs = new Map<string, KickoffRun>();
const listeners = new Set<() => void>();
const polling = new Set<string>();
const checked = new Set<string>();

function persist(run: KickoffRun) {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${run.projectId}`, JSON.stringify(run));
  } catch {
    // Private mode / quota — the in-memory run still works for this visit.
  }
}

function restore(projectId: string): KickoffRun | null {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return null;
    const saved = JSON.parse(raw) as KickoffRun;
    saved.names ??= [];
    return saved;
  } catch {
    return null;
  }
}

function set(run: KickoffRun) {
  runs.set(run.projectId, run);
  persist(run);
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getKickoffRun(projectId: string): KickoffRun | null {
  const live = runs.get(projectId);
  if (live) return live;
  if (typeof window === "undefined") return null;
  const restored = restore(projectId);
  // Cache it so useSyncExternalStore sees a stable snapshot between renders.
  if (restored) runs.set(projectId, restored);
  return restored;
}

/** Forget a finished run — the card goes back to its idle form. */
export function clearKickoffRun(projectId: string) {
  runs.delete(projectId);
  try {
    sessionStorage.removeItem(`${STORAGE_PREFIX}${projectId}`);
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

/**
 * The server has no record of a run this page last saw running: the server
 * restarted mid-run (a deploy). Everything that landed is in the database;
 * only the progress list is gone, so say that rather than spin forever.
 */
function markLost(run: KickoffRun): KickoffRun {
  return {
    ...run,
    running: false,
    finished: true,
    interrupted: true,
    steps: run.steps.map((s) =>
      s.state === "running" || s.state === "pending"
        ? { ...s, state: "failed", note: "Stopped — Loki restarted before this step finished." }
        : s,
    ),
  };
}

async function fetchServerRun(projectId: string): Promise<KickoffRun | null | undefined> {
  try {
    const res = await fetch(`/api/projects/${projectId}/kickoff`, { cache: "no-store" });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { run?: KickoffRun | null };
    return body.run ?? null;
  } catch {
    return undefined; // offline / suspended — keep what we have and retry
  }
}

/** Mirror the server's run until it settles. One live poller per project. */
const generation = new Map<string, number>();
const settledCallbacks = new Map<string, () => void>();

function watch(projectId: string, onSettled?: () => void, restart = false) {
  if (onSettled) settledCallbacks.set(projectId, onSettled);
  if (polling.has(projectId) && !restart) return;
  polling.add(projectId);
  // A restart supersedes the old loop instead of running beside it.
  const mine = (generation.get(projectId) ?? 0) + 1;
  generation.set(projectId, mine);
  const stop = () => {
    polling.delete(projectId);
    const cb = settledCallbacks.get(projectId);
    settledCallbacks.delete(projectId);
    cb?.();
  };
  const tick = async () => {
    if (generation.get(projectId) !== mine) return;
    const server = await fetchServerRun(projectId);
    if (generation.get(projectId) !== mine) return;
    const local = runs.get(projectId);
    if (server) set({ ...server, names: [...new Set([...(local?.names ?? []), ...server.names])] });
    else if (server === null && local?.running) set(markLost(local));
    const now = runs.get(projectId);
    if (!now || !now.running) return stop();
    // A suspended tab stops timers; the visibility listener below resumes it.
    setTimeout(() => void tick(), POLL_MS);
  };
  void tick();
}

if (typeof document !== "undefined") {
  // Coming back to the tab after the phone slept: refresh at once rather than
  // on the next timer, which the browser may have frozen.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    for (const run of runs.values()) if (run.running) watch(run.projectId, undefined, true);
  });
}

/** Ask the server once whether this project has a run we don't know about. */
function discover(projectId: string) {
  if (checked.has(projectId)) return;
  checked.add(projectId);
  void fetchServerRun(projectId).then((server) => {
    const local = getKickoffRun(projectId);
    if (server) {
      set({ ...server, names: [...new Set([...(local?.names ?? []), ...server.names])] });
      if (server.running) watch(projectId);
    } else if (server === null && local?.running) {
      set(markLost(local));
    }
  });
}

/** Live view of one project's kickoff; null when there is none to show. */
export function useKickoffRun(projectId: string | null): KickoffRun | null {
  useEffect(() => {
    if (projectId) discover(projectId);
  }, [projectId]);
  return useSyncExternalStore(
    subscribe,
    () => (projectId ? getKickoffRun(projectId) : null),
    () => null,
  );
}

function matchesTab(run: KickoffRun, tab: string): boolean {
  const want = tab.trim().toLowerCase();
  return run.names.some((n) => n.trim().toLowerCase() === want);
}

let restoredAll = false;
function getKickoffRunForTab(tab: string | null): KickoffRun | null {
  if (!tab || typeof window === "undefined") return null;
  if (!restoredAll) {
    restoredAll = true;
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) getKickoffRun(key.slice(STORAGE_PREFIX.length));
      }
    } catch {
      // ignore
    }
  }
  let found: KickoffRun | null = null;
  for (const run of runs.values()) {
    if (matchesTab(run, tab) && (!found || run.startedAt > found.startedAt)) found = run;
  }
  return found;
}

const checkedTabs = new Set<string>();
function discoverTab(tab: string) {
  const key = tab.trim().toLowerCase();
  if (checkedTabs.has(key)) return;
  checkedTabs.add(key);
  void fetch(`/api/projects/kickoff?tab=${encodeURIComponent(tab)}`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { run?: KickoffRun | null } | null) => {
      const server = body?.run;
      if (!server) return;
      set(server);
      if (server.running) watch(server.projectId);
    })
    .catch(() => undefined);
}

/** The kickoff for a project named by its Terminal tab / workspace key, if any. */
export function useKickoffRunForTab(tab: string | null): KickoffRun | null {
  useEffect(() => {
    if (tab) discoverTab(tab);
  }, [tab]);
  return useSyncExternalStore(
    subscribe,
    () => getKickoffRunForTab(tab),
    () => null,
  );
}

/**
 * Ask the server to run the plan, then watch it. Resolves once the request is
 * accepted — the steps run on the server whether or not this page stays open.
 */
export async function startKickoff(
  projectId: string,
  opts: {
    names: string[];
    plan: KickoffStepId[];
    source: string | null;
    visibility: "private" | "public";
    onSettled?: () => void;
  },
): Promise<void> {
  if (runs.get(projectId)?.running) return;
  const { names, plan, source, visibility } = opts;
  // Paint the steps at once; the server's snapshot replaces this in ~a second.
  set(initialKickoffRun({ projectId, names, plan, source, visibility }));
  try {
    const res = await postJson(`/api/projects/${projectId}/kickoff`, {
      plan,
      source,
      visibility,
      names,
    });
    const body = (await res.json().catch(() => ({}))) as { run?: KickoffRun; error?: string };
    if (!res.ok || !body.run) throw new Error(body.error ?? `HTTP ${res.status}`);
    set({ ...body.run, names: [...new Set([...names, ...body.run.names])] });
    watch(projectId, opts.onSettled);
  } catch (e) {
    const current = runs.get(projectId);
    if (!current) return;
    const reason = e instanceof Error && !/fetch|network/i.test(e.message) ? e.message : null;
    set({
      ...current,
      running: false,
      finished: true,
      steps: current.steps.map((s, i) =>
        i === 0
          ? {
              ...s,
              state: "failed",
              note: reason ?? "Couldn't reach Loki — check your connection and try again.",
            }
          : s,
      ),
    });
  }
}
