/**
 * "Is something being built right now?" — one derived answer for the project
 * page, from the sources the page already loads. No new state.
 *
 * Why this exists: the page could not answer the question. A project kicked
 * off from OrangeCat was dispatched at 22:31, its agent went silent after 113
 * bytes of output, the reaper closed the run at 00:15 — and the next morning
 * the page opened on "No live agent" with a small "Run next step" button in a
 * card halfway down. The timed-out run was a tag under the Activity tab. The
 * person asked "how do I know that something is being built?" because nothing
 * on the page said so, either way.
 *
 * Two lies this guards against, both observed:
 *  - `agentRunning` is a runner's CLAIM at push time. When the runner stops
 *    reporting a project, the row freezes at "running" — the slug-keyed row for
 *    that project still said `agent_running=t` two hours after the agent died.
 *    A claim past the runner-offline threshold is expired, not true.
 *  - An open run is not a running agent. The run above stayed "open" for 104
 *    minutes while nothing happened. Past a short grace window, an open run
 *    with no fresh runtime observation is a dispatch that nobody picked up.
 */
import type { ProjectState } from "@/db/schema/project-states";
import type { RepoCommit } from "@/lib/github-commits";
import { isRuntimeObservationFresh } from "@/lib/project-session";
import { MINUTE_MS } from "@/lib/constants/time";
import { normalizeRunShipping, shippingLanded, type RunShipping } from "@/lib/control-run-shipping";

type StateLike = Pick<
  ProjectState,
  "agentRunning" | "runtimeObservedAt" | "currentPromptLabel" | "currentPromptStartedAt"
>;

type RunLike = {
  startedAt: Date;
  finishedAt: Date | null;
  outcome: string | null;
  state: string;
  summary: { commit?: string } | null;
  payload: unknown;
};

/** How long a dispatched run may sit unobserved before it reads as stalled
 *  rather than starting. The runner heartbeats every 5 minutes; three missed
 *  beats is no longer "warming up". */
export const BUILD_QUEUED_GRACE_MS = 15 * MINUTE_MS;

export type LastAttempt = {
  /** `outcome` when the run has one, else its terminal state. */
  outcome: string;
  startedAtMs: number;
  finishedAtMs: number;
  durationMinutes: number;
  /** Something reached the repo: the run reported a commit, commits landed
   *  after it started, or the fix ledger saw the change deployed. A timeout
   *  that still shipped is not "nothing". */
  landed: boolean;
  /** Where the change got to after the run closed — PR, merge, deploy. The
   *  outcome is stamped at close; this keeps moving. Absent when the ledger
   *  never looked. */
  shipping: RunShipping | null;
  error: string | null;
};

export type BuildStatus =
  /** A runner observed an agent on this project within the offline threshold. */
  | { kind: "building"; sinceMs: number | null; label: string | null }
  /** Dispatched moments ago; no runtime observation yet. */
  | { kind: "queued"; sinceMs: number }
  /** Dispatched, never observed running, and past the grace window. */
  | { kind: "stalled"; sinceMs: number }
  /** Nothing running. `last` is the most recent finished run, if any. */
  | { kind: "idle"; last: LastAttempt | null };

export function deriveBuildStatus(input: {
  state: StateLike | null | undefined;
  runs: RunLike[];
  commits: RepoCommit[] | null | undefined;
  nowMs: number;
}): BuildStatus {
  const { state, runs, commits, nowMs } = input;

  // A live agent process is not a live build. Once a run CLOSES, Claude Code
  // sits at its prompt with the process still up, so the runner keeps
  // reporting agent_running=t — and the page said "Building now · An agent is
  // working" beside "Finished · PR #1 merged 35m ago" (farmaciadelparco,
  // 2026-10-07). The agent is building only while a run is open, or when it
  // was given a prompt AFTER the last run closed (typed in the terminal).
  const hasOpenRun = runs.some((run) => !run.finishedAt);
  const lastFinishMs = Math.max(
    -Infinity,
    ...runs.map((r) => r.finishedAt?.getTime() ?? -Infinity),
  );
  const promptMs = state?.currentPromptStartedAt?.getTime() ?? null;
  const doneWithPrompt =
    !hasOpenRun && Number.isFinite(lastFinishMs) && (promptMs == null || promptMs <= lastFinishMs);

  if (state?.agentRunning && isRuntimeObservationFresh(state, nowMs) && !doneWithPrompt) {
    return {
      kind: "building",
      sinceMs: state.currentPromptStartedAt?.getTime() ?? null,
      label: state.currentPromptLabel?.trim() || null,
    };
  }

  const open = runs
    .filter((run) => !run.finishedAt)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  if (open) {
    const sinceMs = open.startedAt.getTime();
    return nowMs - sinceMs < BUILD_QUEUED_GRACE_MS
      ? { kind: "queued", sinceMs }
      : { kind: "stalled", sinceMs };
  }

  const finished = runs
    .filter((run): run is RunLike & { finishedAt: Date } => run.finishedAt != null)
    .sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime())[0];
  if (!finished) return { kind: "idle", last: null };

  const startedAtMs = finished.startedAt.getTime();
  const finishedAtMs = finished.finishedAt.getTime();
  const reportedCommit = finished.summary?.commit;
  const landed =
    (typeof reportedCommit === "string" &&
      reportedCommit.trim() !== "" &&
      reportedCommit !== "none") ||
    (commits ?? []).some((commit) => commit.atMs > startedAtMs);
  const payload = finished.payload as { error?: unknown; fix?: unknown } | null;
  const error = typeof payload?.error === "string" ? payload.error : null;
  const shipping = normalizeRunShipping(payload?.fix) ?? null;
  return {
    kind: "idle",
    last: {
      outcome: finished.outcome ?? finished.state,
      startedAtMs,
      finishedAtMs,
      durationMinutes: Math.max(0, Math.round((finishedAtMs - startedAtMs) / MINUTE_MS)),
      landed: landed || shippingLanded(shipping),
      shipping,
      error,
    },
  };
}

/** True while an agent is, or is about to be, working — the states in which
 *  offering to start another one would be a second agent on the same repo. */
export function isBuildActive(status: BuildStatus): boolean {
  return status.kind === "building" || status.kind === "queued";
}

/**
 * Every key a `project_states` row for this project might be filed under.
 *
 * The page looks state up by project id, but 92 of the 104 rows on the box
 * have none: the runner heartbeat files rows under the tab name it sees, which
 * is the checkout's directory — `one-shot.slop-the-one-shot-slop-machine` —
 * while dispatch files under the display name — `one-shot.slop — The One-Shot
 * Slop Machine`. Same project, two rows, neither linked to the entity. The
 * page read neither and reported "No live agent" while the runner's row said
 * the opposite.
 */
export function projectStateKeys(input: {
  name: string;
  userProjectName?: string | null;
  dirPath?: string | null;
  gitUrl?: string | null;
}): string[] {
  const keys = new Set<string>();
  const add = (value: string | null | undefined) => {
    const key = value?.trim().toLowerCase();
    if (key) keys.add(key);
  };
  add(input.name);
  add(input.userProjectName);
  add(lastSegment(input.dirPath));
  add(lastSegment(input.gitUrl)?.replace(/\.git$/i, ""));
  return [...keys];
}

function lastSegment(path: string | null | undefined): string | null {
  const trimmed = path?.trim().replace(/[/\\]+$/, "");
  if (!trimmed) return null;
  const segment = trimmed.split(/[/\\]/).pop();
  return segment || null;
}
