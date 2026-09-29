import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { promptHistory } from "@/db/schema/prompt-history";
import {
  getOrchestrationRunById,
  mergeRunPayload,
  stampFeedbackAutoRetried,
} from "@/db/queries/orchestration-runs";
import { getProjectCore } from "@/db/queries/projects";
import { getUserProjectByEntityId, updateUserProject } from "@/db/queries/user-projects";
import { getFeedbackByRunId } from "@/db/queries/site-feedback";
import { logDebug } from "@/db/queries/debug-logs";
import { injectPrompt } from "@/lib/inject-core";
import { providerChoiceFor } from "@/lib/provider-choice";
import { routeAroundSpent } from "@/lib/provider-switch";
import { isQuotaAlternativeId, providerLabel } from "@/config/quota-alternatives";
import { resolveImplementAdapter } from "@/lib/feedback/implement";
import { decideAutoReimplement } from "@/lib/feedback/auto-reimplement-policy";
import { looksLikeAgentCapacityIssue } from "@/lib/agent-resolution";
import { AUTO_DISPATCH_OFF_REASON, autoDispatchEnabled } from "@/lib/auto-dispatch";

/**
 * Run a project's failed request again — on a provider that can answer.
 *
 * Feedback fixes already had this (auto-reimplement → routeAroundSpent). The
 * runs "Make it happen" and project dispatch start did not: on 2026-09-29 a
 * kickoff hit "claude cannot generate because its usage limit is exhausted",
 * the Watch page said "Failed", and the only way forward was to know that a
 * provider switch existed and where it lived. One path now serves both the
 * automatic second attempt and the one-tap button:
 *
 *   - auto (runner nack): once per run, never for failures that need a person
 *     (dead credentials, missing workspace), and — for a capacity wall — only
 *     when another provider can actually answer; re-running the spent agent
 *     would just fail again.
 *   - explicit (button): the provider the person picked, remembered as the
 *     project's preference, the same rule the Feedback switch follows.
 *
 * The prompt re-sent is the one that failed (prompt_history.custom_prompt for
 * that run), so a retry is the same request, not a re-derived one.
 */

export type RetryResult =
  | { ok: true; runId: string | null; agent: string; agentLabel: string; from: string | null }
  | { ok: false; status: number; error: string };

async function lastPromptFor(userId: string, runId: string): Promise<string | null> {
  const [row] = await db
    .select({ customPrompt: promptHistory.customPrompt })
    .from(promptHistory)
    .where(and(eq(promptHistory.userId, userId), eq(promptHistory.runId, runId)))
    .orderBy(desc(promptHistory.dispatchedAt))
    .limit(1);
  const text = row?.customPrompt?.trim();
  return text ? text : null;
}

export async function retryProjectRun(
  userId: string,
  failedRunId: string,
  opts: { agent?: string; auto?: { because: string } } = {},
): Promise<RetryResult> {
  const run = await getOrchestrationRunById(userId, failedRunId);
  if (!run?.projectId) return { ok: false, status: 404, error: "Run not found" };
  const project = await getProjectCore(userId, run.projectId);
  if (!project) return { ok: false, status: 404, error: "Project not found" };
  const prompt = await lastPromptFor(userId, run.id);
  if (!prompt) {
    return {
      ok: false,
      status: 409,
      error: "The original request was not recorded — start it again from the project.",
    };
  }

  if (opts.agent && !isQuotaAlternativeId(opts.agent)) {
    return { ok: false, status: 400, error: `Unknown provider: ${opts.agent}` };
  }
  const up = await getUserProjectByEntityId(userId, run.projectId).catch(() => null);

  let agent: string;
  let from: string | null = null;
  if (opts.agent) {
    agent = opts.agent;
    from = run.adapter !== agent ? run.adapter : null;
    // An explicit pick is the operator deciding: remembered for the project.
    if (up && up.agentPref !== agent) {
      await updateUserProject(up.id, userId, { agentPref: agent }).catch(() => undefined);
    }
  } else {
    const failedOn = run.adapter;
    const choice = up
      ? await providerChoiceFor(userId, up, { current: failedOn }).catch(() => null)
      : null;
    const error = run.payload?.error ?? "";
    const spent = { ...(choice?.spent ?? {}) };
    // The failure we are answering IS evidence, even before any list saw it.
    if (looksLikeAgentCapacityIssue(error)) spent[failedOn] = error;
    const decided = choice
      ? routeAroundSpent({ preferred: failedOn, spent, options: choice.options })
      : { agent: failedOn, rerouted: null };
    if (!decided.rerouted && spent[failedOn]) {
      return { ok: false, status: 409, error: "No other provider can answer right now." };
    }
    agent = decided.agent;
    from = decided.rerouted ? failedOn : null;
  }

  const { status, body } = await injectPrompt(
    {
      tab: project.name,
      projectId: run.projectId,
      allowHostedFallback: false,
      customPrompt: prompt,
      adapter: resolveImplementAdapter(agent),
    },
    userId,
  );
  if (status >= 400 || !body.ok) {
    return {
      ok: false,
      status: status >= 400 ? status : 502,
      error: typeof body.error === "string" ? body.error : "The retry was not accepted.",
    };
  }
  const runId = typeof body.runId === "string" ? body.runId : null;
  if (runId) {
    await mergeRunPayload(runId, {
      priorRunId: run.id,
      ...(opts.auto ? { autoRetriedBecause: opts.auto.because } : {}),
      ...(from ? { reroutedFrom: from } : {}),
    }).catch(() => undefined);
  }
  return { ok: true, runId, agent, agentLabel: providerLabel(agent), from };
}

/**
 * The runner refused a project run at its last step. Feedback runs are
 * answered by auto-reimplement; this answers everything else, once.
 * Never throws: it is called from the runner's ack path.
 */
export async function autoRetryProjectRunAfterNack(
  userId: string,
  runId: string,
  error: string | null | undefined,
  runPayload: { priorRunId?: unknown; feedbackAutoRetriedAt?: unknown } | null | undefined,
): Promise<{ retried: boolean; reason?: string }> {
  try {
    // Off by default — see src/lib/auto-dispatch.ts. The Watch page keeps
    // Failed with the one-tap provider button; nothing runs unasked.
    if (!autoDispatchEnabled()) return { retried: false, reason: AUTO_DISPATCH_OFF_REASON };
    const decision = decideAutoReimplement(error, runPayload);
    if (!decision.retry) return { retried: false, reason: decision.reason };
    if (await getFeedbackByRunId(userId, runId).catch(() => null)) {
      return { retried: false, reason: "feedback-run" };
    }
    // Stamp first: a crash between here and the new run can never loop.
    await stampFeedbackAutoRetried(runId, userId);
    const result = await retryProjectRun(userId, runId, { auto: { because: decision.because } });
    void logDebug({
      source: "project-auto-retry",
      level: result.ok ? "info" : "warn",
      message: result.ok
        ? `Project run ${runId} retried on ${result.agent}: ${decision.because}`
        : `Project run ${runId} not retried: ${result.error}`,
      meta: { userId, runId, error },
    });
    return result.ok ? { retried: true } : { retried: false, reason: result.error };
  } catch (e) {
    void logDebug({
      source: "project-auto-retry",
      level: "error",
      message: e instanceof Error ? e.message : String(e),
      meta: { userId, runId, error },
    }).catch(() => undefined);
    return { retried: false, reason: "threw" };
  }
}
