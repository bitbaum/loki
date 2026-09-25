import { NextRequest, NextResponse } from "next/server";
import { readIdParam, readJsonBody, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getFeedbackWithProject, setFeedbackStatus } from "@/db/queries/site-feedback";
import { getOrchestrationRunById, mergeRunPayload } from "@/db/queries/orchestration-runs";
import { injectPrompt } from "@/lib/inject-core";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { composeFeedbackFixPrompt } from "@/lib/feedback/compose-dispatch";
import { deriveFeedbackWork, FEEDBACK_WORK_PHASE } from "@/lib/feedback/work-phase";
import { hydrateFeedbackSnapshot } from "@/lib/feedback/attach-work";
import { getCurrentClaudeSessionForProject } from "@/db/queries/agent-sessions";
import { DEFAULT_ADAPTER_ID, ORCHESTRATION_ADAPTER_IDS, type AdapterId } from "@/lib/orchestration";
import { feedbackInjectAccepted } from "@/lib/feedback/dispatch-accept";
import { isQuotaAlternativeId, providerLabel } from "@/config/quota-alternatives";
import { getUserProject, updateUserProject } from "@/db/queries/user-projects";
import { providerChoiceFor } from "@/lib/provider-choice";
import { routeAroundSpent } from "@/lib/provider-switch";

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
  /**
   * Switch provider and retry, in one tap.
   *
   * The whole point of the field is that it PERSISTS: a retry that ran on a
   * different agent but left `agentPref` pointing at the one that just hit a
   * rate limit sent the next dispatch straight back into the wall, and the
   * operator had to find the preference in project settings to make it stick.
   * So this writes the project's preference and then dispatches on it — one
   * decision recorded once, in the place every other dispatch path reads.
   */
  agent: z.string().trim().max(40).optional(),
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
  if (!row.canEdit) return jsonError("Only project owners and editors can implement feedback", 403);
  const executionUserId = row.ownerUserId;

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
      ? await getOrchestrationRunById(executionUserId, row.feedback.dispatchedRunId)
      : null;
    // Hydrated: without builder presence this guard cannot tell a live agent
    // from one queued on a builder that is switched off, so it refused the
    // retry the row was asking for.
    const work = deriveFeedbackWork(
      row.feedback.status,
      await hydrateFeedbackSnapshot(executionUserId, run),
    );
    if (work.phase === FEEDBACK_WORK_PHASE.QUEUED || work.phase === FEEDBACK_WORK_PHASE.WORKING) {
      return jsonError(
        "Already on this — Watch the terminal, or wait for Telegram when it needs you / stalls.",
        409,
      );
    }
  }

  // Provider switch: validate against the chooser's own id list, record it as
  // the project's preference, then dispatch on it. Rejected rather than
  // silently defaulted — a one-tap switch that quietly re-ran the spent agent
  // would look exactly like a switch that worked.
  const requestedAgent = dataOrResp.agent;
  if (requestedAgent && !isQuotaAlternativeId(requestedAgent)) {
    return jsonError(`Unknown provider: ${requestedAgent}`, 400);
  }
  if (requestedAgent && requestedAgent !== row.agentPref) {
    await updateUserProject(row.userProjectId, executionUserId, { agentPref: requestedAgent });
  }

  // Don't walk into a known wall. When the operator picked nothing this tap,
  // the preferred agent is checked against what Loki has OBSERVED: a capacity
  // refusal inside the spent window routes this run to the next provider in
  // the operator's own ranking — without touching the stored preference, so
  // the next dispatch after the quota recovers goes back to it. An explicit
  // `agent` is the operator deciding, and is never second-guessed.
  const preferred = resolveImplementAdapter(requestedAgent ?? row.agentPref);
  let adapter: AdapterId = preferred;
  let rerouted: { from: string; to: string; because: string } | null = null;
  if (!requestedAgent) {
    const project = await getUserProject(row.userProjectId, executionUserId).catch(() => null);
    const choice = project
      ? await providerChoiceFor(executionUserId, project, { current: preferred }).catch(() => null)
      : null;
    if (choice) {
      const decided = routeAroundSpent({
        preferred,
        spent: choice.spent,
        options: choice.options,
      });
      if (decided.rerouted) {
        adapter = resolveImplementAdapter(decided.agent);
        rerouted = { from: preferred, to: adapter, because: decided.rerouted.because };
      }
    }
  }
  const currentSession =
    adapter === "claude"
      ? await getCurrentClaudeSessionForProject(
          executionUserId,
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
    executionUserId,
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
    await setFeedbackStatus(executionUserId, idOrResp, FEEDBACK_STATUS.DISPATCHED, runId);
    // The run records where it was MEANT to go and why it did not, so the
    // ledger can tell "ran on Claude Code" from "was sent to Claude Code
    // because Cursor was spent" — the second is evidence, the first is not.
    if (rerouted && runId) {
      await mergeRunPayload(runId, {
        reroutedFrom: rerouted.from,
        reroutedBecause: rerouted.because,
      }).catch(() => undefined);
    }
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
      // Said out loud, not done quietly: the operator chose the other agent.
      ...(rerouted && {
        rerouted,
        notice: `${rerouted.because} This run is on ${providerLabel(rerouted.to)} instead; your default stays ${providerLabel(rerouted.from)}.`,
      }),
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
