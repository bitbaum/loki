import { NextRequest, NextResponse } from "next/server";
import { readIdParam, readJsonBody, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getFeedbackWithProject, setFeedbackStatus } from "@/db/queries/site-feedback";
import { getOrchestrationRunById } from "@/db/queries/orchestration-runs";
import { injectPrompt } from "@/lib/inject-core";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { composeFeedbackFixPrompt } from "@/lib/feedback/compose-dispatch";
import { deriveFeedbackWork, FEEDBACK_WORK_PHASE } from "@/lib/feedback/work-phase";
import { runToFeedbackSnapshot } from "@/lib/feedback/attach-work";
import { getCurrentClaudeSessionForProject } from "@/db/queries/agent-sessions";
import { DEFAULT_ADAPTER_ID, ORCHESTRATION_ADAPTER_IDS, type AdapterId } from "@/lib/orchestration";
import { feedbackInjectAccepted } from "@/lib/feedback/dispatch-accept";

/**
 * One-click Implement: queue a scoped agent run via injectPrompt.
 * Returns runId when accepted. Allows Retry when a prior run is stuck/failed
 * (not while a run is queued or actively working).
 *
 * Agent choice: the project's agentPref when it is an orchestration adapter the
 * runner can launch. Claude is the only worker with a durable session id today,
 * so session resume applies only when the chosen adapter is Claude. openclaw is
 * accepted by orchestration ids but is not launchable — fall through to default.
 */

const DispatchBody = z.object({
  note: z.string().trim().max(500).optional(),
});

/** Adapters Implement may start. openclaw is orchestration-listed but not launchable. */
const IMPLEMENT_ADAPTERS = ORCHESTRATION_ADAPTER_IDS.filter((id) => id !== "openclaw");

function resolveImplementAdapter(agentPref: string | null | undefined): AdapterId {
  // UI may say Antigravity; orchestration id is still gemini.
  const pref = agentPref === "antigravity" || agentPref === "agy" ? "gemini" : agentPref;
  if (pref && (IMPLEMENT_ADAPTERS as readonly string[]).includes(pref)) {
    return pref as AdapterId;
  }
  return DEFAULT_ADAPTER_ID;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const dataOrResp = await readJsonBody(req, DispatchBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const row = await getFeedbackWithProject(userId, idOrResp);
  if (!row) return jsonError("Feedback not found", 404);

  // Verify the project actually exists in user_projects before dispatching.
  // This prevents creating runs for projects that can't be found by inject.
  if (!row.userProjectId) {
    return jsonError(
      "Project configuration not found. The project may need to be re-registered on the Projects page.",
      422,
    );
  }
  // No folder and no repository = the runner launches an agent into a
  // directory that does not exist, the prompt lands on nothing, and the row
  // reads "Not running" ten minutes later with no explanation. Refuse here,
  // with the fix, before a run row exists.
  if (!row.hasWorkspace) {
    return jsonError(
      "This project has no repository or folder yet, so there is nowhere for the agent to work. Add a Git URL on the project page, then Implement.",
      422,
    );
  }

  if (
    row.feedback.status === FEEDBACK_STATUS.RESOLVED ||
    row.feedback.status === FEEDBACK_STATUS.ARCHIVED
  ) {
    return jsonError("Reopen the item before dispatching again", 409);
  }
  if (row.feedback.status === FEEDBACK_STATUS.DISPATCHED) {
    // Same derivation the badges render — the gate and the UI can't disagree.
    // QUEUED/WORKING → refuse the duplicate; STUCK/FAILED (including a
    // dispatched row whose run record is missing) → allow the retry.
    const run = row.feedback.dispatchedRunId
      ? await getOrchestrationRunById(userId, row.feedback.dispatchedRunId)
      : null;
    const work = deriveFeedbackWork(row.feedback.status, runToFeedbackSnapshot(run));
    if (work.phase === FEEDBACK_WORK_PHASE.QUEUED || work.phase === FEEDBACK_WORK_PHASE.WORKING) {
      return jsonError(
        "Already on this — Watch the terminal, or wait for Telegram when it needs you / stalls.",
        409,
      );
    }
  }

  const adapter = resolveImplementAdapter(row.agentPref);
  const currentSession =
    adapter === "claude"
      ? await getCurrentClaudeSessionForProject(
          userId,
          row.projectName,
          new Date(),
          row.feedback.projectId,
        )
      : null;

  // Prefer the always-on box (cloud). Hosted Hermes is the offline backup so
  // Implement never sits Queued with no pickup. refuseOfflineQueue fails with
  // one next action when neither path can run — never "Working" with no PTY.
  const { status, body } = await injectPrompt(
    {
      tab: row.projectName,
      projectId: row.feedback.projectId,
      allowHostedFallback: true,
      refuseOfflineQueue: true,
      // Honor user_projects.builder_pref via pickDispatchChannel — do not force cloud.
      adapter,
      sessionId: currentSession?.sessionId,
      customPrompt: composeFeedbackFixPrompt(
        row.feedback,
        row.projectName,
        dataOrResp.note || undefined,
      ),
      notifyOnClose: true,
    },
    userId,
  );

  // Accepted = inject returned ok with a tracked run id, and did not refuse
  // (blocked: user typing). status < 400 alone is not enough: inject can answer
  // 200/ok when it refused mid-keystroke or when run-create failed — marking
  // those Queued/Working is the closed-loop lie.
  // Snapshot outcome fields BEFORE the accept type-guard — it narrows body to
  // { runId } and TypeScript then forgets mode / hosted / nextAction.
  const mode = typeof body.mode === "string" ? body.mode : null;
  const hostedDispatchId = typeof body.hostedDispatchId === "string" ? body.hostedDispatchId : null;
  const nextAction = typeof body.nextAction === "string" ? body.nextAction : null;

  const accepted = feedbackInjectAccepted(status, body);
  const runId = accepted ? body.runId : undefined;
  if (accepted) {
    await setFeedbackStatus(userId, idOrResp, FEEDBACK_STATUS.DISPATCHED, runId);
  }

  const workLabel = accepted
    ? mode === "direct"
      ? "Working"
      : hostedDispatchId
        ? "Queued on hosted runner"
        : "Queued"
    : undefined;

  return NextResponse.json(
    {
      ...body,
      adapter,
      sessionId: currentSession?.sessionId ?? null,
      sessionAction: adapter === "claude" ? (currentSession ? "resumed" : "started") : "started",
      workLabel,
      // Add helpful context for common failures
      ...(status === 404 && {
        hint: "The project may need to be registered on the Projects page, or the agent may need to be started.",
      }),
      ...(nextAction && { nextAction }),
    },
    {
      // Keep blocked (user-typing) at its inject status so the UI can warn.
      // A bare ok without a run id is not acceptance — surface it as a failure.
      status: accepted || body.blocked ? status : status < 400 && !runId ? 502 : status,
    },
  );
}
