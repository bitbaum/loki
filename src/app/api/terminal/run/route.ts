import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { isValidUuid } from "@/lib/utils";
import {
  getLatestRunForProjectKey,
  getOrchestrationRunById,
} from "@/db/queries/orchestration-runs";
import { hydrateFeedbackSnapshot } from "@/lib/feedback/attach-work";
import { deriveFeedbackWork } from "@/lib/feedback/work-phase";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { buildTerminalRunView } from "@/lib/terminal-run-view";

/**
 * GET /api/terminal/run?project=X&run=Y
 *
 * Commentary for the Terminal Loki rail: the same run Watch is looking at,
 * collapsed to phase + next action. Never a run_events dump.
 */
export async function GET(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  const project = req.nextUrl.searchParams.get("project")?.trim() || null;
  const runParam = req.nextUrl.searchParams.get("run")?.trim() || null;
  if (runParam && !isValidUuid(runParam)) return jsonError("Invalid run id", 400);
  if (!project && !runParam) return jsonError("project or run is required", 400);

  const run = runParam
    ? await getOrchestrationRunById(userId, runParam)
    : project
      ? await getLatestRunForProjectKey(userId, project)
      : null;
  if (!run) return jsonOk({ view: null });

  // One hydrate, shared with the inbox row, Watch and Implement's guard. This
  // route used to keep its own copy, and that copy still fell back to "any
  // builder will do" when the channel was unknown — reporting a local run
  // healthy whenever the cloud box happened to be up.
  const snap = await hydrateFeedbackSnapshot(userId, run);

  const work = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, snap);
  const view = buildTerminalRunView({
    runId: run.id,
    projectKey: run.projectKey,
    work,
    lastProgressAt: snap?.lastProgressAt ?? null,
    error: snap?.error ?? null,
  });

  return jsonOk({ view });
}

export const runtime = "nodejs";
