import { NextResponse } from "next/server";
import { readIdParam, jsonError } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getFeedbackWithProject } from "@/db/queries/site-feedback";
import { getOrchestrationRunById } from "@/db/queries/orchestration-runs";
import { listRunEventsForRun } from "@/db/queries/run-events";
import { getCommandById } from "@/db/queries/pending-commands";
import { runToFeedbackSnapshot } from "@/lib/feedback/attach-work";
import { deriveFeedbackWork } from "@/lib/feedback/work-phase";
import { runEventKindLabel } from "@/lib/feedback/run-step";
import { deriveDispatchLiveStatus } from "@/lib/dispatch-status";
import { fleetSurfaceHref } from "@/lib/fleet-context";

/**
 * Watch payload for one feedback item — short step + dig-in event trail +
 * Terminal href. Progressive disclosure: the row shows stepSummary; this
 * endpoint fills the expanded panel without dumping a PTY wall of text.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const row = await getFeedbackWithProject(userId, idOrResp);
  if (!row) return jsonError("Feedback not found", 404);

  const run = row.feedback.dispatchedRunId
    ? await getOrchestrationRunById(userId, row.feedback.dispatchedRunId)
    : null;
  const snap = runToFeedbackSnapshot(run);
  const work = deriveFeedbackWork(row.feedback.status, snap);

  const events = run
    ? (await listRunEventsForRun(run.id, userId)).map((e) => ({
        kind: e.kind,
        label: runEventKindLabel(e.kind),
        at: e.createdAt.toISOString(),
        detail: e.detail,
      }))
    : [];

  let commandLive: ReturnType<typeof deriveDispatchLiveStatus> | null = null;
  const commandId =
    work.commandId ?? (run?.payload as { commandId?: string } | null)?.commandId ?? null;
  if (commandId) {
    const cmd = await getCommandById(commandId);
    if (cmd && cmd.userId === userId) {
      commandLive = deriveDispatchLiveStatus({
        claimedAt: cmd.claimedAt,
        executedAt: cmd.executedAt,
        result: (cmd.result ?? null) as {
          ok?: boolean | null;
          verified?: boolean | null;
          warning?: string | null;
          error?: string | null;
        },
        run: run
          ? {
              state: run.state,
              outcome: run.outcome,
              payload: run.payload ? { error: run.payload.error } : null,
            }
          : null,
      });
    }
  }

  const terminalHref = fleetSurfaceHref("terminal", row.projectName, undefined, run?.id);

  return NextResponse.json({
    work: {
      phase: work.phase,
      label: work.label,
      stepSummary: work.stepSummary ?? commandLive?.label ?? work.label,
      queueReason: work.queueReason ?? commandLive?.detail ?? null,
      diagnostic: work.diagnostic ?? null,
      terminalReady: work.terminalReady === true,
      watchable: work.watchable === true,
    },
    events,
    commandLive,
    terminalHref,
    projectName: row.projectName,
    runId: run?.id ?? null,
  });
}
