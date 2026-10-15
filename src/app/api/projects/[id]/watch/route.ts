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
import { buildTerminalRunView } from "@/lib/terminal-run-view";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { getServerKickoff } from "@/lib/kickoff/server-runs";
import { buildWatchTimeline } from "@/lib/project-watch";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { providerLabel } from "@/config/quota-alternatives";

/**
 * GET /api/projects/[id]/watch — the latest run of a project as a readable
 * thread (lib/project-watch), plus the phase line and where to go next. The
 * same hydrate + work-phase as Terminal's rail and Feedback's Watch, so every
 * surface gives one answer about the same run.
 *
 * `?run=<id>` pins one run of THIS project — the widget's "Follow the build"
 * for one change must keep showing that change, not whatever ran last.
 */
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

  const [events, promptRow, snap] = await Promise.all([
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
  const [up, autopilotOverride, beacon] = await Promise.all([
    getUserProjectByEntityId(executionUserId, idOrResp).catch(() => null),
    getProjectAutopilotOverride(executionUserId, project.name).catch(() => null),
    getBeaconSettings(executionUserId),
  ]);
  const failed = Boolean(run.finishedAt) && (view.phase === "failed" || view.stalled);
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
        error: run.payload?.error ?? snap?.error ?? null,
      },
      tab: ownerView ? tab : undefined,
      provider: {
        current: run.adapter,
        currentLabel: providerLabel(run.adapter),
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
