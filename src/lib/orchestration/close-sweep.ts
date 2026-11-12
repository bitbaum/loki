/**
 * Unattended run-close sweep — close open runs from runner-PUSHED session state.
 *
 * The only run-closer used to be the /api/control GET: it reads the freshest
 * session handoff and closes the run — but it only executes when a human loads
 * the page. Unattended (autopilot at 04:00, founder asleep), a box agent would
 * finish its task, push its handoff, and the run still sat open until the
 * reaper stamped it. This sweep runs on the clock (reap-stale-runs cron, BEFORE
 * reaping): for every open run, project the persisted project_states row into a
 * SessionState and put it through the exact same seam close + DoD gate the page
 * path uses. Same inputs, same gate, same ledger — just no human required.
 *
 * node-only (the claude seam pulls in fs) — import from route handlers only.
 */
import { listOpenRuns } from "@/db/queries/orchestration-runs";
import { enqueueTabCommand, hasUndeliveredCommandForRun } from "@/db/queries/pending-commands";
import { getProjectState } from "@/db/queries/project-states";
import type { SessionState } from "@/lib/control-types";
import { getRecentOutcomes } from "@/db/queries/orchestration-runs";
import { resolveProjectSession } from "@/lib/project-session";
import { adapterFor } from "@/lib/orchestration/adapter-registry";
import {
  ORCHESTRATION_ADAPTER_IDS,
  DEFAULT_ADAPTER_ID,
  type AdapterId,
} from "@/lib/orchestration/contract";
import { gateAndCloseRun, closingRuns } from "@/lib/orchestration/gate-and-close";

export type CloseSweepResult = {
  checked: number;
  closed: Array<{ runId: string; projectKey: string; outcome: string }>;
};

type OpenRunRow = Awaited<ReturnType<typeof listOpenRuns>>[number];

/** The derived session tab a parallel run (phase 2 worktree-per-agent) carries
 *  in its payload, or null for ordinary runs. */
function runSessionTab(run: OpenRunRow): string | null {
  const payload = run.payload as { sessionTab?: unknown } | null;
  return typeof payload?.sessionTab === "string" ? payload.sessionTab : null;
}

/** Try to close ONE open run from its project's pushed session state (or a
 *  directly-supplied session for parallel-alias runs). Returns the closed
 *  outcome, or null when the run stays open. */
async function tryCloseRun(
  run: OpenRunRow,
  sessionOverride?: SessionState,
): Promise<string | null> {
  if (closingRuns.has(run.id)) return null; // another close is in flight
  // A run whose dispatch command is still queued (gate-held behind an older
  // run, or runner offline) never had its prompt delivered — no handoff can be
  // its work. Without this, run A's ready handoff swept run B closed with an
  // identical summary and close-the-loop resolved B's feedback off A's work.
  //
  // This check alone is NOT sufficient, and the 2026-08-24 recurrence shows
  // why: it infers non-delivery from a pending_commands row that another
  // process deletes. purgeStalePendingCommands drops a gate-held command once
  // its own run passes STALE_RUN_MINUTES — the same 60-minute boundary at
  // which this sweep runs — so the row vanishes and its absence reads as
  // "delivered". Two undelivered runs were closed `success` off a sibling's
  // handoff, and their visitor feedback was auto-resolved as shipped.
  // closeRunFromSession therefore gates on the run's OWN durable deliveredAt
  // stamp; this stays as the cheap early-out.
  if (await hasUndeliveredCommandForRun(run.userId, run.id).catch(() => false)) return null;
  let session = sessionOverride ?? null;
  if (!session) {
    // A parallel run's handoff lives under its DERIVED tab, not the project's
    // state row — closing it from the base project's session would let run A's
    // ready handoff close run B (both open, both post-dating). Such runs close
    // only via closeOpenRunBySessionTab; the reaper covers true losses.
    if (runSessionTab(run)) return null;
    const state = await getProjectState(run.userId, run.projectKey).catch(() => null);
    session = resolveProjectSession(null, state);
  }
  if (!session) return null;

  const adapterId: AdapterId = (ORCHESTRATION_ADAPTER_IDS as readonly string[]).includes(
    run.adapter,
  )
    ? (run.adapter as AdapterId)
    : DEFAULT_ADAPTER_ID;
  const patch = adapterFor(adapterId)?.closeRunFromSession?.(run, session) ?? null;
  if (!patch) return null; // handoff not ready / predates the run — leave open

  closingRuns.add(run.id);
  try {
    const recent = await getRecentOutcomes(run.userId, run.projectKey).catch(() => []);
    await gateAndCloseRun(
      run.id,
      patch,
      run.userId,
      run.projectKey,
      recent.map((r) => r.outcome),
      run.adapter,
    );
    return patch.outcome;
  } finally {
    closingRuns.delete(run.id);
  }
}

/** Close every open run whose project's pushed session state reports a ready
 *  handoff newer than the run start. Serial on purpose — each close may invoke
 *  the cross-model DoD judge, and a cron tick has headroom while a thundering
 *  herd of judge calls does not. */
export async function closeOpenRunsFromPushedState(): Promise<CloseSweepResult> {
  const open = await listOpenRuns();
  const closed: CloseSweepResult["closed"] = [];

  for (const run of open) {
    const outcome = await tryCloseRun(run).catch(() => null);
    if (outcome) closed.push({ runId: run.id, projectKey: run.projectKey, outcome });
  }

  return { checked: open.length, closed };
}

/**
 * Immediate variant for the runtime-state ingestion path: the moment a runner
 * pushes a `ready` handoff for a project, close that project's open run —
 * no waiting for the hourly cron tick. minAge 0: the handoff's own
 * "post-dates run start" guard (closeRunFromSession) is the race protection.
 */
export async function closeOpenRunsForProject(userId: string, projectKey: string): Promise<number> {
  const open = await listOpenRuns(0);
  let n = 0;
  for (const run of open) {
    if (run.userId !== userId || run.projectKey.toLowerCase() !== projectKey.toLowerCase())
      continue;
    const outcome = await tryCloseRun(run).catch(() => null);
    if (outcome) n++;
  }
  return n;
}

/**
 * Close the ONE parallel run whose payload.sessionTab matches a pushed derived-
 * tab handoff (phase 2 worktree-per-agent). The session comes straight from
 * the runner's push — alias tabs are deliberately never persisted as
 * project_states rows (they'd show up as ghost project cards and clobber the
 * base project's runtime facts), so this is their only close path besides the
 * reaper. Precise by construction: one alias ↔ one run.
 */
export async function closeOpenRunBySessionTab(
  userId: string,
  sessionTab: string,
  session: SessionState,
): Promise<boolean> {
  const open = await listOpenRuns(0);
  const run = open.find((r) => r.userId === userId && runSessionTab(r) === sessionTab);
  if (!run) return false;
  const outcome = await tryCloseRun(run, session).catch(() => null);
  if (outcome != null) await closeOneOffTab(run, sessionTab);
  return outcome != null;
}

/** A fresh one-off session has reported: close its tab, so the agent cannot
 *  go on to anything else and its lane is free again. Best effort: the
 *  session limit and the reaper still hold if the command is lost. */
async function closeOneOffTab(run: OpenRunRow, sessionTab: string): Promise<void> {
  const payload = run.payload as { oneOff?: unknown; oneOffChannel?: unknown } | null;
  if (payload?.oneOff !== true) return;
  const channel =
    payload.oneOffChannel === "cloud" || payload.oneOffChannel === "local"
      ? payload.oneOffChannel
      : undefined;
  await enqueueTabCommand(run.userId, "close_tab", {
    tab: sessionTab,
    ...(channel ? { channel } : {}),
  }).catch((err: unknown) => console.error("[close-sweep] one-off tab close failed:", err));
}
