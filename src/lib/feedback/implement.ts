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
 * Implement a feedback item: queue a scoped agent run via injectPrompt.
 * Returns runId when accepted. Allows Retry when a prior run is stuck/failed
 * (not while a run is queued or actively working).
 *
 * Agent choice: the project's agentPref when it is an orchestration adapter the
 * runner can launch. Claude is the only worker with a durable session id today,
 * so session resume applies only when the chosen adapter is Claude. openclaw is
 * accepted by orchestration ids but is not launchable — fall through to default.
 */

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

export type ImplementFeedbackResult = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * The ONE way a feedback item becomes an agent run from a person's request.
 * The Implement button and the owner's own widget note both come through
 * here, so they cannot drift. `actorUserId` is whoever is asking; access is
 * checked against the project, exactly as for the button.
 */
export async function implementFeedback(
  actorUserId: string,
  feedbackId: string,
  opts: { note?: string; agent?: string } = {},
): Promise<ImplementFeedbackResult> {
  const row = await getFeedbackWithProject(actorUserId, feedbackId);
  if (!row) return { status: 404, body: { error: "Feedback not found" } };
  if (!row.canEdit)
    return {
      status: 403,
      body: { error: "Only project owners and editors can implement feedback" },
    };
  const executionUserId = row.ownerUserId;

  // Verify the project actually exists in user_projects before dispatching.
  // This prevents creating runs for projects that can't be found by inject.
  if (!row.userProjectId) {
    return {
      status: 422,
      body: {
        error:
          "Project configuration not found. The project may need to be re-registered on the Projects page.",
      },
    };
  }
  // No folder and no repository = the runner launches an agent into a
  // directory that does not exist, the prompt lands on nothing, and the row
  // reads "Not running" ten minutes later with no explanation. Refuse here,
  // with the fix, before a run row exists.
  if (!row.hasWorkspace) {
    return {
      status: 422,
      body: {
        error:
          "This project has no repository or folder yet, so there is nowhere for the agent to work. Add a Git URL on the project page, then Implement.",
      },
    };
  }

  if (
    row.feedback.status === FEEDBACK_STATUS.RESOLVED ||
    row.feedback.status === FEEDBACK_STATUS.ARCHIVED
  ) {
    return { status: 409, body: { error: "Reopen the item before dispatching again" } };
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
      return {
        status: 409,
        body: {
          error:
            "Already on this — Watch the terminal, or wait for Telegram when it needs you / stalls.",
        },
      };
    }
  }

  // Provider switch: validate against the chooser's own id list, record it as
  // the project's preference, then dispatch on it. Rejected rather than
  // silently defaulted — a one-tap switch that quietly re-ran the spent agent
  // would look exactly like a switch that worked.
  const requestedAgent = opts.agent;
  if (requestedAgent && !isQuotaAlternativeId(requestedAgent)) {
    return { status: 400, body: { error: `Unknown provider: ${requestedAgent}` } };
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
      customPrompt: composeFeedbackFixPrompt(row.feedback, row.projectName, opts.note || undefined),
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
    await setFeedbackStatus(executionUserId, feedbackId, FEEDBACK_STATUS.DISPATCHED, runId);
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

  return {
    body: {
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
    status: accepted || body.blocked ? status : status < 400 && !runId ? 502 : status,
  };
}
