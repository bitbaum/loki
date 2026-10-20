import { NextRequest, NextResponse } from "next/server";
import { previewWalkthrough } from "@/lib/previews/walkthrough";
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
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { getServerKickoff } from "@/lib/kickoff/server-runs";
import { buildWatchTimeline } from "@/lib/project-watch";
import { loadRunTrack } from "@/lib/run-track-load";
import { providerLabel } from "@/config/quota-alternatives";

/**
 * GET /api/projects/[id]/watch — the latest run of a project as a readable
 * thread (lib/project-watch), plus the phase line and where to go next. The
 * same hydrate + work-phase as Terminal's rail and Feedback's Watch, so every
 * surface gives one answer about the same run.
 *
 * It also carries the delivery track (lib/run-track, loaded by
 * lib/run-track-load — the same loader the chat card's status routes call,
 * so both screens tell one story): where the change IS, from the ask to the
 * live site. `following` tells the page to keep asking until nothing can
 * move any more.
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

  // One loader for every surface that shows a run (lib/run-track-load): the
  // events, the runner's snapshot, what was asked, and — for the owner's
  // own view only, since it uses their token and budget — the branch or
  // pull request on GitHub, the commits and checks behind it, and after the
  // run the ledger through merge, deploy and Loki's look.
  const loaded = await loadRunTrack(executionUserId, run, { ownerView });
  const { events, view, track, follow, fix, following, provider, error, failed } = loaded;
  const up = loaded.project;

  const items = buildWatchTimeline({
    prompt: loaded.prompt
      ? {
          text: ownerView ? loaded.prompt.text : dispatchMessageDisplay(loaded.prompt.text).text,
          at: loaded.prompt.at,
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
  // A pull request the ledger discounted (opened before the run) is not this
  // change's; its note is not this change's walkthrough. A preview folder has
  // no pull request: its build leaves the same account in improvements.json.
  const ownPr = fix && !fix.foreignPr ? (fix.pr ?? null) : null;
  const walkthrough = ownPr?.note ?? (await previewWalkthrough(executionUserId, idOrResp));

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
      walkthrough,
      liveUrl: up?.liveUrl ?? null,
      tab: ownerView ? tab : undefined,
      provider: {
        current: run.adapter,
        currentLabel: provider,
        reroutedFrom: run.payload?.reroutedFrom ?? null,
        reroutedFromLabel: run.payload?.reroutedFrom
          ? providerLabel(run.payload.reroutedFrom)
          : null,
        reroutedWhy: run.payload?.reroutedWhy ?? null,
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
