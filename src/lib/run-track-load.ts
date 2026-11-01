/**
 * The delivery track for one run, loaded — the server half of lib/run-track.
 *
 * Every surface that shows a run's progress asks THIS and draws the result
 * with components/projects/RunTrack: the Watch page, the chat card under a
 * dispatch, the prompt library's "Send to terminal". Until 2026-10-17 the
 * chat card had its own list (run-milestones: picked up → pushed → PR →
 * checks) and Watch another, read from different facts, so a person moving
 * between the two screens read two stories about one change. One loader,
 * one track, the same words everywhere.
 *
 * What it gathers, all of it facts: the run's events and the runner's
 * snapshot (phase, who has it, last output), what was asked and when, the
 * branch or pull request found on GitHub while the run lives
 * (run-evidence-live, once a minute), the commits and check state on it
 * (repo-progress, once a minute), and after the run the fix ledger through
 * merge, deploy and Loki's look at the live page (run-follow). Anything that
 * reaches GitHub or spends the owner's budget is asked only for the owner's
 * own view (`ownerView`), and only while a card is open — never from a timer
 * (scripts/test/no-free-background-ai.ts).
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { promptHistory } from "@/db/schema/prompt-history";
import type { RunEventKind } from "@/db/schema/run-events";
import { listRunEventsForRun } from "@/db/queries/run-events";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { providerLabel } from "@/config/quota-alternatives";
import { hydrateFeedbackSnapshot } from "@/lib/feedback/attach-work";
import { deriveFeedbackWork, type FeedbackRunSnapshot } from "@/lib/feedback/work-phase";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { FIX_SHIP_STATE, type FixShipping } from "@/lib/feedback/fix-shipping";
import { buildTerminalRunView, type TerminalRunView } from "@/lib/terminal-run-view";
import { humanizeRunFailure } from "@/lib/project-watch";
import { buildRunTrack, type RunTrack } from "@/lib/run-track";
import { isPreviewDir } from "@/lib/previews/root";
import { findLiveRunEvidence, repoTokenFor } from "@/lib/run-evidence-live";
import { FOLLOW_WINDOW_MS, followRunLedger } from "@/lib/run-follow";
import type { RunFollow } from "@/lib/run-handoff";
import { normalizeRepoWorkEvidence } from "@/lib/repo-evidence";
import { fetchRepoProgress, type RepoProgress } from "@/lib/repo-progress";
import { ORCHESTRATION_OUTCOME } from "@/lib/orchestration/contract";
import { RUN_BLOCKED } from "@/lib/run-progress";

/** Which builder has it, in words. SSOT for the track's "picked it up" row. */
const BUILDER_WORDS: Record<string, string> = {
  cloud: "the cloud runner",
  local: "this computer",
};

export type TrackableRun = {
  id: string;
  state: string;
  projectId: string | null;
  projectKey: string;
  adapter: string;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: string | null;
  summary: { done?: string } | null;
  payload: {
    error?: string | null;
    evidence?: unknown;
    fix?: FixShipping;
    beforePicture?: string;
    reroutedFrom?: string | null;
    sessionTab?: string | null;
  } | null;
};

export type RunTrackLoad = {
  track: RunTrack;
  /** After the run: the change's way to the live site (chat card words). */
  follow: RunFollow | null;
  fix: FixShipping | null;
  /** The track can still move: keep asking. */
  following: boolean;
  /** The pieces Watch also reads for its thread and status line. */
  events: { kind: RunEventKind; detail: Record<string, unknown> | null; createdAt: Date }[];
  snap: FeedbackRunSnapshot | null;
  view: TerminalRunView;
  prompt: { text: string; at: Date } | null;
  project: { id: string; gitUrl: string | null; liveUrl: string | null } | null;
  provider: string;
  error: string | null;
  failed: boolean;
};

const SETTLED_LEDGER: ReadonlySet<string> = new Set([
  FIX_SHIP_STATE.PR_CLOSED,
  FIX_SHIP_STATE.DEPLOY_FAILED,
]);

export async function loadRunTrack(
  userId: string,
  run: TrackableRun,
  opts: { ownerView?: boolean; now?: number } = {},
): Promise<RunTrackLoad> {
  const ownerView = opts.ownerView ?? true;
  const now = opts.now ?? Date.now();
  const [events, promptRow, snap, project] = await Promise.all([
    listRunEventsForRun(run.id, userId, 100),
    db
      .select({
        resolvedPrompt: promptHistory.resolvedPrompt,
        customPrompt: promptHistory.customPrompt,
        dispatchedAt: promptHistory.dispatchedAt,
      })
      .from(promptHistory)
      .where(and(eq(promptHistory.userId, userId), eq(promptHistory.runId, run.id)))
      .orderBy(desc(promptHistory.dispatchedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    hydrateFeedbackSnapshot(userId, run),
    run.projectId ? getUserProjectByEntityId(userId, run.projectId).catch(() => null) : null,
  ]);

  const work = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, snap);
  const view = buildTerminalRunView({
    runId: run.id,
    projectKey: run.projectKey,
    work,
    lastProgressAt: snap?.lastProgressAt ?? null,
    error: snap?.error ?? null,
  });
  // What was ASKED, not the dispatch envelope around it: resolved_prompt is
  // wrapped in Loki's operator preamble ("# Loki operator dispatch…").
  const promptText = promptRow?.customPrompt ?? promptRow?.resolvedPrompt ?? null;
  const prompt = promptText && promptRow ? { text: promptText, at: promptRow.dispatchedAt } : null;

  const finished = Boolean(run.finishedAt);
  const failed = finished && (view.phase === "failed" || view.stalled);
  const finishedWell =
    finished &&
    (run.outcome === ORCHESTRATION_OUTCOME.SUCCESS ||
      run.outcome === ORCHESTRATION_OUTCOME.PARTIAL);
  const recent = now - (run.finishedAt ?? run.startedAt).getTime() < FOLLOW_WINDOW_MS;

  // ── Where the change is ───────────────────────────────────────────────
  // Evidence from GitHub, for the owner's own view only (it uses their
  // token). Live: the branch or pull request the agent has pushed so far.
  // Closed well with a ledger that found no pull request: one more look, in
  // case the handoff never named the one that exists.
  let evidence = normalizeRepoWorkEvidence(run.payload?.evidence);
  const cachedFix = run.payload?.fix ?? null;
  const ledgerBlind =
    !cachedFix ||
    (cachedFix.state === FIX_SHIP_STATE.NO_EVIDENCE && !cachedFix.pr) ||
    cachedFix.state === FIX_SHIP_STATE.PUSHED;
  const gitUrl = project?.gitUrl ?? null;
  if (ownerView && !evidence && (!finished || (finishedWell && ledgerBlind)) && recent) {
    evidence = await findLiveRunEvidence(userId, run, gitUrl, now);
  }
  const runForFollow =
    evidence && !run.payload?.evidence
      ? { ...run, payload: { ...(run.payload ?? {}), evidence } }
      : run;
  const [{ follow, fix }, repo] = await Promise.all([
    ownerView
      ? followRunLedger(userId, runForFollow, now).catch(() => ({ follow: null, fix: cachedFix }))
      : Promise.resolve({ follow: null, fix: cachedFix }),
    // The commits and checks behind the stages, while they can still change.
    ownerView && gitUrl && recent && !(cachedFix && SETTLED_LEDGER.has(cachedFix.state))
      ? repoProgress(userId, run, gitUrl, now)
      : Promise.resolve(null),
  ]);

  const provider = providerLabel(run.adapter);
  const error = run.payload?.error ?? snap?.error ?? null;
  // The first time each hop happened — the track dates its stages by these.
  const eventTimes: Partial<Record<RunEventKind, string>> = {};
  for (const e of events) eventTimes[e.kind] ??= e.createdAt.toISOString();
  // A pull request the ledger discounted (opened before the run) is not this
  // change's; the track must not point at it.
  const ownPr = fix && !fix.foreignPr ? (fix.pr ?? null) : null;
  const track = buildRunTrack({
    eventKinds: events.map((e) => e.kind),
    eventTimes,
    run: {
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      outcome: run.outcome ?? null,
    },
    askedAt: promptRow?.dispatchedAt?.toISOString() ?? null,
    phase: view.phase,
    stalled: view.stalled,
    lastProgressAt: snap?.lastProgressAt ?? null,
    needsYou:
      snap?.blocked === RUN_BLOCKED.AUTH
        ? "It is waiting at a sign-in prompt."
        : snap?.blocked === RUN_BLOCKED.PERMISSION
          ? `It is asking: ${snap.blockedQuestion?.trim() || "permission to run a tool"}`
          : snap?.blocked === RUN_BLOCKED.EXITED
            ? `It stopped: ${snap.blockedQuestion?.trim() || "the agent process ended"}`
            : null,
    builderLabel: BUILDER_WORDS[snap?.builderChannel ?? ""] ?? null,
    evidence,
    repo,
    fix: fix
      ? {
          state: fix.state,
          prUrl: ownPr?.url ?? null,
          prTitle: ownPr?.title ?? null,
          prNumber: ownPr?.number ?? null,
          mergedAt: ownPr?.mergedAt ?? null,
          deploy: fix.deploy
            ? { name: fix.deploy.name, url: fix.deploy.url, at: fix.deploy.at ?? null }
            : null,
          liveUrl: follow?.liveUrl ?? null,
          looked: fix.verify
            ? { verdict: fix.verify.verdict, evidence: fix.verify.evidence, at: fix.verify.at }
            : null,
        }
      : null,
    liveUrl: project?.liveUrl ?? null,
    providerLabel: provider,
    failure: failed ? humanizeRunFailure(error, provider, view.quotaDeath) : null,
    followable: recent,
    savedLive: isPreviewDir(project?.dirPath),
  });
  // Keep asking while the change can still move — through merge, deploy and
  // Loki's look — but not for a run that closed days ago.
  const following = ownerView && finishedWell && !track.settled && recent;

  return {
    track,
    follow,
    fix,
    following,
    events,
    snap,
    view,
    prompt,
    project: project ? { id: project.id, gitUrl, liveUrl: project.liveUrl ?? null } : null,
    provider,
    error,
    failed,
  };
}

async function repoProgress(
  userId: string,
  run: TrackableRun,
  gitUrl: string,
  now: number,
): Promise<RepoProgress | null> {
  const token = await repoTokenFor(userId, gitUrl);
  if (!token) return null;
  return fetchRepoProgress(run.id, gitUrl, token, run.startedAt.getTime(), now).catch(() => null);
}
