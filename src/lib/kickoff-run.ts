"use client";

/**
 * The "Make it happen" run, held OUTSIDE the component that shows it.
 *
 * It used to live in ProjectKickoff's useState. The run takes a minute or two
 * (two model calls, a GitHub repository, CD registration, a dispatch), and a
 * person who has just pressed the biggest button on the page naturally goes to
 * look at Terminal or Control while it works. Leaving unmounted the card: the
 * steps kept running in the background, but coming back showed a fresh "Make it
 * happen" as if nothing had been pressed, and no other page knew a run existed.
 * That is exactly the "is it doing anything?" feeling the button exists to end.
 *
 * So the run is a module-level store keyed by project. Every surface that cares
 * (the kickoff card, the Terminal's empty state) subscribes to the same object,
 * the run survives in-app navigation because nothing owns it, and its last
 * state is mirrored to sessionStorage so a reload says what happened instead of
 * forgetting. A reload DOES stop a run mid-way (the browser owns the requests);
 * that is reported as "interrupted", never silently as done.
 */

import { useSyncExternalStore } from "react";
import { postJson } from "@/lib/api/fetch";
import type { KickoffStepId } from "@/lib/project-kickoff";
import type { SiteDeployment } from "@/hooks/use-site-deployment";

export type KickoffStepState = "pending" | "running" | "done" | "failed";
export type KickoffStepRun = { id: KickoffStepId; state: KickoffStepState; note?: string };

/** Where the agent ended up, so the card can send people to the right page. */
export type KickoffDispatchOutcome = "running" | "queued-offline" | "not-sent" | "failed";

export type KickoffRun = {
  projectId: string;
  /** How other surfaces name this project — Terminal only knows the tab. */
  names: string[];
  steps: KickoffStepRun[];
  running: boolean;
  finished: boolean;
  /** The page was reloaded while this was running — the tail never ran. */
  interrupted?: boolean;
  startedAt: number;
  dispatch?: KickoffDispatchOutcome;
  deployment?: SiteDeployment;
};

const STORAGE_PREFIX = "loki:kickoff:";
const runs = new Map<string, KickoffRun>();
const listeners = new Set<() => void>();

function storageKey(projectId: string) {
  return `${STORAGE_PREFIX}${projectId}`;
}

function persist(run: KickoffRun) {
  try {
    sessionStorage.setItem(storageKey(run.projectId), JSON.stringify(run));
  } catch {
    // Private mode / quota — the in-memory run still works for this visit.
  }
}

/** A run found in storage but not in memory was cut off by a reload. */
function restore(projectId: string): KickoffRun | null {
  try {
    const raw = sessionStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as KickoffRun;
    saved.names ??= [];
    if (!saved.running) return saved;
    return {
      ...saved,
      running: false,
      finished: true,
      interrupted: true,
      steps: saved.steps.map((s) =>
        s.state === "running" || s.state === "pending"
          ? { ...s, state: "failed", note: "Stopped — the page was reloaded before this step ran." }
          : s,
      ),
    };
  } catch {
    return null;
  }
}

function set(run: KickoffRun) {
  runs.set(run.projectId, run);
  persist(run);
  for (const l of listeners) l();
}

function update(projectId: string, patch: (run: KickoffRun) => KickoffRun) {
  const current = runs.get(projectId);
  if (current) set(patch(current));
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
    sessionStorage.removeItem(storageKey(projectId));
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Live view of one project's kickoff; null when none has run this session. */
export function useKickoffRun(projectId: string | null): KickoffRun | null {
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

/** Restore every run this browser tab has seen, so a lookup by name works after a reload. */
function restoreAll() {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) getKickoffRun(key.slice(STORAGE_PREFIX.length));
    }
  } catch {
    // ignore
  }
}

let restoredAll = false;
function getKickoffRunForTab(tab: string | null): KickoffRun | null {
  if (!tab || typeof window === "undefined") return null;
  if (!restoredAll) {
    restoredAll = true;
    restoreAll();
  }
  let found: KickoffRun | null = null;
  for (const run of runs.values()) {
    if (matchesTab(run, tab) && (!found || run.startedAt > found.startedAt)) found = run;
  }
  return found;
}

/** The kickoff for a project named by its Terminal tab / workspace key, if any. */
export function useKickoffRunForTab(tab: string | null): KickoffRun | null {
  return useSyncExternalStore(
    subscribe,
    () => getKickoffRunForTab(tab),
    () => null,
  );
}

/** Any kickoff still running — so a page can warn before a reload stops it. */
export function anyKickoffRunning(): boolean {
  for (const run of runs.values()) if (run.running) return true;
  return false;
}

function mark(projectId: string, id: KickoffStepId, state: KickoffStepState, note?: string) {
  update(projectId, (run) => ({
    ...run,
    steps: run.steps.map((s) => (s.id === id ? { ...s, state, note } : s)),
  }));
}

/** POST a step's route; returns its JSON body, or null with the step marked failed. */
async function step(
  projectId: string,
  id: KickoffStepId,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  mark(projectId, id, "running");
  try {
    const res = await postJson(`/api/projects/${projectId}/${path}`, body);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !json.ok) {
      mark(
        projectId,
        id,
        "failed",
        typeof json.error === "string" ? json.error : `HTTP ${res.status}`,
      );
      return null;
    }
    return json;
  } catch {
    mark(projectId, id, "failed", "Network error — check your connection and try again.");
    return null;
  }
}

type CdResponse = SiteDeployment & {
  ok?: boolean;
  predictedLiveUrl?: string;
  error?: string;
};

async function registerCd(projectId: string, repoName: string, template: string | undefined) {
  try {
    const cdRes = await postJson(`/api/projects/${projectId}/register-cd`, {
      template:
        template === "bare" || template === "nextjs-tailwind" ? template : "nextjs-tailwind",
    });
    const cd = (await cdRes.json()) as CdResponse;
    if (!cdRes.ok || !cd.ok) return cd.error ? `${repoName} · site deploy: ${cd.error}` : repoName;
    update(projectId, (run) => ({ ...run, deployment: cd }));
    if (cd.registered && cd.liveUrl) return `${repoName} · live ${cd.liveUrl}`;
    const why = cd.reason?.trim();
    const cmd = cd.command?.trim();
    if (why || cmd) return `${repoName} · ${why && cmd ? `${why} — ${cmd}` : why || cmd}`;
    if (cd.predictedLiveUrl) return `${repoName} · site will be ${cd.predictedLiveUrl}`;
    return repoName;
  } catch {
    return `${repoName} · site deploy skipped (network)`;
  }
}

/**
 * Run the plan. Resolves when every step has landed or failed; the store is
 * the result, so callers only need `onSettled` to refresh server data.
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
  const { plan, source, visibility } = opts;
  set({
    projectId,
    names: opts.names.filter(Boolean),
    steps: plan.map((id) => ({ id, state: "pending" })),
    running: true,
    finished: false,
    startedAt: Date.now(),
  });

  const finish = (dispatch?: KickoffDispatchOutcome) => {
    update(projectId, (run) => ({ ...run, running: false, finished: true, dispatch }));
    opts.onSettled?.();
  };

  // Profile and milestones read the same text and don't depend on each other.
  // Run them together — serialising two model calls is waiting for nothing.
  await Promise.all(
    plan
      .filter((id) => id === "profile" || id === "milestones")
      .map(async (id) => {
        const json = await step(projectId, id, id === "profile" ? "brief" : "roadmap", {
          text: source,
        });
        if (!json) return;
        if (id === "profile") {
          const count = Object.keys((json.applied as object) ?? {}).length;
          mark(projectId, id, "done", `${count} field${count === 1 ? "" : "s"} filled`);
        } else {
          const created = (json.created as string[]) ?? [];
          mark(
            projectId,
            id,
            "done",
            `${created.length} milestone${created.length === 1 ? "" : "s"}`,
          );
        }
      }),
  );

  // Repo second: "auto" resolves the starter from the stack the profile step
  // just wrote, so this only picks well once that has landed.
  if (plan.includes("repo")) {
    const json = await step(projectId, "repo", "provision", { template: "auto", visibility });
    if (!json) {
      // No repository — do not dispatch. An agent with nowhere to write code is
      // worse than a paused kickoff; Try again resumes from here.
      mark(projectId, "dispatch", "failed", "Not started — the repository step has to land first.");
      return finish("not-sent");
    }
    if (json.templateSeeded === false) {
      // The repo exists but is bare: nothing to deploy, nothing to build on.
      // Try again re-seeds the same repo (provision detects the bare repo).
      mark(
        projectId,
        "repo",
        "failed",
        "Repository created, but the starter files were not written. Try again to add them.",
      );
      mark(projectId, "dispatch", "failed", "Not started — waiting on the starter files.");
      return finish("not-sent");
    }
    const repo = json.repo as { full_name?: string } | undefined;
    const template = typeof json.template === "string" ? json.template : undefined;
    // Same flow, next beat: wire Hetzner CD (or return the one box command).
    mark(projectId, "repo", "running", "Repository created — connecting the site deploy…");
    const note = await registerCd(projectId, repo?.full_name ?? "Repository created", template);
    mark(projectId, "repo", "done", note);
  }

  // Dispatch last. The prompt is composed server-side from whatever landed —
  // including the brief, which the profile step saves even when the model fails.
  const dispatched = await step(projectId, "dispatch", "dispatch", { kind: "kickoff" });
  if (!dispatched) return finish("failed");

  // `ok: true` is not the same as "an agent is working". injectPrompt answers
  // ok when it REFUSED because the user was mid-keystroke in the target tab,
  // and when it queued a command with no builder connected to collect it.
  if (dispatched.blocked) {
    mark(projectId, "dispatch", "failed", "Not sent — you were typing in that session. Try again.");
    return finish("not-sent");
  }
  if (dispatched.warning === "runner-offline") {
    mark(
      projectId,
      "dispatch",
      "done",
      "Queued — no builder is online yet, so the agent starts the moment one connects.",
    );
    return finish("queued-offline");
  }
  mark(
    projectId,
    "dispatch",
    "done",
    dispatched.mode === "direct"
      ? "Agent is working now."
      : "Sent to the builder — the session opens in Terminal within a minute.",
  );
  finish("running");
}
