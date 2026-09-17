import { ORCHESTRATION_OUTCOME } from "@/db/schema/orchestration-runs";
import { runReportText } from "@/lib/orchestration/summary";
import type { OrchestrationRun } from "@/db/schema/orchestration-runs";

/**
 * The message Loki writes back into the conversation that dispatched a run.
 *
 * A dispatch typed into /loki used to end at "Dispatch queued". The run then
 * closed hours later into run_events, a push notification and (if configured)
 * Telegram — everywhere except the thread the person was typing in. To learn
 * whether "rename the product" had happened you had to leave Loki and open
 * GitHub, which is the one trip this product exists to make unnecessary.
 *
 * Pure: takes the closed run plus what the caller could find out about it
 * (repo evidence, the project's live URL) and returns markdown, or null when
 * the run has no conversation to report to. No I/O, so scripts/test covers it
 * without a database.
 */

/** Longest excerpt of the agent's own summary carried into the thread. */
const SUMMARY_MAX_CHARS = 900;

export type RunOutcomeContext = {
  /** A pull request or push found in the repo during the run's window. */
  evidence?: { kind: string; url: string; title: string } | null;
  /** Where the project is served, if it is. */
  liveUrl?: string | null;
};

export type RunOutcomeMessage = {
  content: string;
  meta: {
    runId: string;
    projectKey: string;
    outcome: string | null;
    prUrl: string | null;
    liveUrl: string | null;
  };
};

function headline(run: Pick<OrchestrationRun, "projectKey" | "outcome">): string {
  switch (run.outcome) {
    case ORCHESTRATION_OUTCOME.SUCCESS:
      return `✅ **${run.projectKey}** — done.`;
    case ORCHESTRATION_OUTCOME.PARTIAL:
      return `🟡 **${run.projectKey}** — partly done.`;
    default:
      return `❌ **${run.projectKey}** — did not finish (${run.outcome ?? "closed"}).`;
  }
}

export function formatRunOutcomeMessage(
  run: Pick<
    OrchestrationRun,
    "id" | "projectKey" | "outcome" | "finishedAt" | "payload" | "summary"
  >,
  ctx: RunOutcomeContext = {},
): RunOutcomeMessage | null {
  const conversationId = run.payload?.conversationId;
  if (!conversationId || !run.finishedAt) return null;

  const summary = runReportText(run);
  const evidence = ctx.evidence ?? run.payload?.evidence ?? null;
  const prUrl = evidence?.kind === "pr" ? evidence.url : null;
  const liveUrl = ctx.liveUrl ?? null;

  const lines: string[] = [headline(run)];
  if (summary) lines.push("", summary.slice(0, SUMMARY_MAX_CHARS));

  if (prUrl) {
    lines.push(
      "",
      `Pull request: ${prUrl}`,
      "It merges on its own once its checks are green, and the deploy follows the merge.",
    );
  } else if (evidence?.url) {
    lines.push(
      "",
      `Pushed: ${evidence.url}`,
      "No pull request was opened, so nothing will merge by itself.",
    );
  } else if (run.outcome === ORCHESTRATION_OUTCOME.SUCCESS) {
    lines.push(
      "",
      "No pull request or push was found for this run — the work may not have left the builder.",
    );
  }
  if (liveUrl) lines.push("", `Live: ${liveUrl}`);

  return {
    content: lines.join("\n"),
    meta: {
      runId: run.id,
      projectKey: run.projectKey,
      outcome: run.outcome ?? null,
      prUrl,
      liveUrl,
    },
  };
}
