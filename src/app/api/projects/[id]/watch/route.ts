import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { promptHistory } from "@/db/schema/prompt-history";
import { getProjectAccess } from "@/db/queries/project-access";
import { dispatchMessageDisplay } from "@/lib/terminal-conversation";
import { getSessionUserId } from "@/lib/session";
import { readIdParam } from "@/lib/api/route-helpers";
import { isValidUuid } from "@/lib/utils";
import { getProjectAutopilotOverride, getProjectCore } from "@/db/queries/projects";
import { getBeaconSettings } from "@/db/queries/beacon-settings";
import {
  getLatestRunForProjectKey,
  getOrchestrationRunById,
  getProjectOrchestrationRuns,
} from "@/db/queries/orchestration-runs";
import { listRunEventsForRun } from "@/db/queries/run-events";
import { hydrateFeedbackSnapshot } from "@/lib/feedback/attach-work";
import { deriveFeedbackWork } from "@/lib/feedback/work-phase";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";
import { buildTerminalRunView } from "@/lib/terminal-run-view";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { getServerKickoff } from "@/lib/kickoff/server-runs";
import { buildWatchTimeline, humanizeRunFailure } from "@/lib/project-watch";
import { buildRunTrack } from "@/lib/run-track";
import { findLiveRunEvidence } from "@/lib/run-evidence-live";
import { FOLLOW_WINDOW_MS, followRunLedger } from "@/lib/run-follow";
import { normalizeRepoWorkEvidence } from "@/lib/repo-evidence";
import { ORCHESTRATION_OUTCOME } from "@/lib/orchestration/contract";
import { RUN_BLOCKED } from "@/lib/run-progress";
import type { RunEventKind } from "@/db/schema/run-events";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { providerLabel } from "@/config/quota-alternatives";

/**
 * GET /api/projects/[id]/watch — the latest run of a project as a readable
 * thread (lib/project-watch), plus the phase line and where to go next. The
 * same hydrate + work-phase as Terminal's rail and Feedback's Watch, so every
 * surface gives one answer about the same run.
 *
 * It also carries the delivery track (lib/run-track): where the change IS,
 * from the ask to the live site. While the run is live the route asks GitHub
 * for the branch or pull request the agent has pushed (lib/run-evidence-live,
 * at most once a minute); once the run has closed it follows the fix ledger
 * through merge and deploy and Loki's look at the live page (lib/run-follow,
 * the same path the chat card takes). `following` tells the page to keep
 * asking until nothing can move any more.
 *
 * `?run=<id>` pins one run of THIS project — the widget's "Follow the build"
 * for one change must keep showing that change, not whatever ran last.
 */
/** The builder in the person's words — the track says who picked it up. */
const BUILDER_WORDS: Record<string, string> = {
  cloud: "the cloud builder",
  local: "this computer",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const access = await getProjectAccess(userId, idOrResp);
  const executionUserId = access?.ownerUserId ?? userId;
  const ownerView = executionUserId === userId;
  const project = await getProjectCore(executionUserId, idOrResp);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const kickoff = getServerKickoff(executionUserId, idOrResp);
  const pinnedId = req.nextUrl.searchParams.get("run");
  if (pinnedId && !isValidUuid(pinnedId))
    return NextResponse.json({ error: "Invalid run" }, { status: 400 });
  const pinned =
    pinnedId && isValidUuid(pinnedId)
      ? await getOrchestrationRunById(executionUserId, pinnedId)
      : null;
  if (pinnedId && (!pinned || pinned.projectId !== idOrResp))
    return NextResponse.json({ error: "Run not found for this project" }, { status: 404 });
  const run =
    (pinned && pinned.projectId === idOrResp ? pinned : null) ??
    (await getProjectOrchestrationRuns(executionUserId, idOrResp, 1))[0] ??
    (await getLatestRunForProjectKey(executionUserId, project.name)) ??
    null;

  if (!run) {
    return NextResponse.json(
      { ok: true, project: { name: project.name }, kickoff, run: null, items: [], status: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [events, promptRow, snap, up] = await Promise.all([
    listRunEventsForRun(run.id, executionUserId, 100),
    db
      .select({
        resolvedPrompt: promptHistory.resolvedPrompt,
        customPrompt: promptHistory.customPrompt,
        dispatchedAt: promptHistory.dispatchedAt,
      })
      .from(promptHistory)
      .where(and(eq(promptHistory.userId, executionUserId), eq(promptHistory.runId, run.id)))
      .orderBy(desc(promptHistory.dispatchedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    hydrateFeedbackSnapshot(executionUserId, run),
    getUserProjectByEntityId(executionUserId, idOrResp).catch(() => null),
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
  // wrapped in Loki's operator preamble ("# Loki operator dispatch…"), which
  // is what the first real Watch showed a person as "You asked".
  const promptText = promptRow?.customPrompt ?? promptRow?.resolvedPrompt ?? null;
  const items = buildWatchTimeline({
    prompt: promptText
      ? {
          text: ownerView ? promptText : dispatchMessageDisplay(promptText).text,
          at: promptRow!.dispatchedAt,
        }
      : null,
    events,
    run: {
      outcome: run.outcome ?? null,
      finishedAt: run.finishedAt ?? null,
      summary: run.summary ?? null,
      error: run.payload?.error ?? null,
    },
  });

  const tab = run.payload?.sessionTab ?? project.name;
  const [autopilotOverride, beacon] = await Promise.all([
    getProjectAutopilotOverride(executionUserId, project.name).catch(() => null),
    getBeaconSettings(executionUserId),
  ]);
  const failed = Boolean(run.finishedAt) && (view.phase === "failed" || view.stalled);
  const finishedWell =
    Boolean(run.finishedAt) &&
    (run.outcome === ORCHESTRATION_OUTCOME.SUCCESS ||
      run.outcome === ORCHESTRATION_OUTCOME.PARTIAL);

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
  if (
    ownerView &&
    !evidence &&
    (!run.finishedAt || (finishedWell && ledgerBlind)) &&
    Date.now() - run.startedAt.getTime() < FOLLOW_WINDOW_MS
  ) {
    evidence = await findLiveRunEvidence(executionUserId, run, up?.gitUrl);
  }
  const runForFollow =
    evidence && !run.payload?.evidence
      ? { ...run, payload: { ...(run.payload ?? {}), evidence } }
      : run;
  const { follow, fix } = ownerView
    ? await followRunLedger(executionUserId, runForFollow).catch(() => ({
        follow: null,
        fix: cachedFix,
      }))
    : { follow: null, fix: cachedFix };

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
    needsYou: snap?.blocked === RUN_BLOCKED.AUTH ? "It is waiting at a sign-in prompt." : null,
    builderLabel: BUILDER_WORDS[snap?.builderChannel ?? ""] ?? null,
    evidence,
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
    liveUrl: up?.liveUrl ?? null,
    providerLabel: provider,
    failure: failed ? humanizeRunFailure(error, provider, view.quotaDeath) : null,
  });
  // Keep asking while the change can still move — through merge, deploy and
  // Loki's look — but not for a run that closed days ago.
  const following =
    ownerView &&
    finishedWell &&
    !track.settled &&
    Date.now() - run.finishedAt!.getTime() < FOLLOW_WINDOW_MS;

  return NextResponse.json(
    {
      ok: true,
      project: { name: project.name },
      kickoff,
      run: {
        id: run.id,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        live: !run.finishedAt,
      },
      items,
      status: {
        phase: view.phase,
        label: view.label,
        stepSummary: view.stepSummary,
        nextAction: view.nextAction,
        stalled: view.stalled,
        terminalReady: ownerView && view.terminalReady,
        lastProgressAt: view.lastProgressAt,
        error,
      },
      track,
      following,
      follow,
      // The agent's own account of the change, from the pull request — what
      // was wrong, what changed, why, who it helps, what it costs.
      walkthrough: ownPr?.note ?? null,
      liveUrl: up?.liveUrl ?? null,
      tab: ownerView ? tab : undefined,
      provider: {
        current: run.adapter,
        currentLabel: provider,
        reroutedFrom: run.payload?.reroutedFrom ?? null,
        reroutedFromLabel: run.payload?.reroutedFrom
          ? providerLabel(run.payload.reroutedFrom)
          : null,
        autoRetriedBecause: run.payload?.autoRetriedBecause ?? null,
        quotaDeath: view.quotaDeath,
      },
      // The one tap: a finished run that did not deliver can be sent again.
      canRetry: ownerView && failed,
      userProjectId: up?.id ?? null,
      // Steer or let go: Watch offers the project's real autopilot switch
      // beside the box that steers it, not a description of either.
      autopilot: ownerView
        ? { override: autopilotOverride, inherited: beacon.auto_inject_mode }
        : undefined,
      terminalHref: ownerView ? fleetSurfaceHref("terminal", tab, undefined, run.id) : undefined,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const runtime = "nodejs";
