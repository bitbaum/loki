import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { promptHistory } from "@/db/schema/prompt-history";
import { getSessionUserId } from "@/lib/session";
import { readIdParam } from "@/lib/api/route-helpers";
import { getProjectCore } from "@/db/queries/projects";
import {
  getLatestRunForProjectKey,
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
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const project = await getProjectCore(userId, idOrResp);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const kickoff = getServerKickoff(userId, idOrResp);
  const run =
    (await getProjectOrchestrationRuns(userId, idOrResp, 1))[0] ??
    (await getLatestRunForProjectKey(userId, project.name)) ??
    null;

  if (!run) {
    return NextResponse.json(
      { ok: true, project: { name: project.name }, kickoff, run: null, items: [], status: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [events, promptRow, snap] = await Promise.all([
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
    prompt: promptText ? { text: promptText, at: promptRow!.dispatchedAt } : null,
    events,
    run: {
      outcome: run.outcome ?? null,
      finishedAt: run.finishedAt ?? null,
      summary: run.summary ?? null,
      error: run.payload?.error ?? null,
    },
  });

  const tab = run.payload?.sessionTab ?? project.name;
  const up = await getUserProjectByEntityId(userId, idOrResp).catch(() => null);
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
        terminalReady: view.terminalReady,
        lastProgressAt: view.lastProgressAt,
        error: run.payload?.error ?? snap?.error ?? null,
      },
      tab,
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
      canRetry: failed,
      userProjectId: up?.id ?? null,
      terminalHref: fleetSurfaceHref("terminal", tab, undefined, run.id),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const runtime = "nodejs";
