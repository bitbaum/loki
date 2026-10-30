import { ORCHESTRATION_OUTCOME } from "@/db/schema/orchestration-runs";
import { runReportText } from "@/lib/orchestration/summary";
import type { OrchestrationRun } from "@/db/schema/orchestration-runs";
import type { FixNote } from "@/lib/feedback/fix-note";
import {
  buildProgressUpdate,
  UPDATE_STAGE,
  type ProgressUpdate,
  type UpdateImage,
  type UpdateLink,
  type UpdateStage,
} from "@/lib/loki/progress-update";

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
  /** Where it will be posted, when that is not the dispatching thread — a
   *  run from the feedback inbox reports into its project's updates thread. */
  conversationId?: string | null;
  /** A pull request or push found in the repo during the run's window. */
  evidence?: { kind: string; url: string; title: string } | null;
  /** Where the project is served, if it is. */
  liveUrl?: string | null;
  /** The design note from the pull request (fix-note.ts), when it had one. */
  note?: FixNote | null;
  /** What was asked, when the run came from a feedback report. */
  asked?: string | null;
  /** Pictures that belong with the update (the report's own screenshot). */
  images?: UpdateImage[];
};

export type RunOutcomeMessage = {
  content: string;
  meta: {
    runId: string;
    projectKey: string;
    outcome: string | null;
    prUrl: string | null;
    liveUrl: string | null;
    /** The structured update the chat renders as a card (progress-update.ts). */
    update: ProgressUpdate;
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
  const conversationId = ctx.conversationId ?? run.payload?.conversationId;
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
      "No pull request or push was found for this run — the work may not have left the runner.",
    );
  }
  if (liveUrl) lines.push("", `Live: ${liveUrl}`);

  const stage: UpdateStage =
    run.outcome === ORCHESTRATION_OUTCOME.PARTIAL
      ? UPDATE_STAGE.PARTIAL
      : run.outcome !== ORCHESTRATION_OUTCOME.SUCCESS
        ? UPDATE_STAGE.NOT_DONE
        : prUrl
          ? UPDATE_STAGE.READY
          : evidence?.url
            ? UPDATE_STAGE.PUSHED
            : UPDATE_STAGE.NOT_DONE;
  const links: UpdateLink[] = [];
  if (prUrl) links.push({ label: "What changed", href: prUrl });
  else if (evidence?.url) links.push({ label: "The push", href: evidence.url });
  if (liveUrl) links.push({ label: "The site", href: liveUrl });
  const update = buildProgressUpdate({
    stage,
    project: run.projectKey,
    asked: ctx.asked ?? null,
    note: ctx.note ?? null,
    didLine: run.summary?.done ?? null,
    summaryNext: run.summary?.next ?? null,
    checks: checksLine(run.summary),
    images: ctx.images,
    links,
  });

  return {
    content: lines.join("\n"),
    meta: {
      runId: run.id,
      projectKey: run.projectKey,
      outcome: run.outcome ?? null,
      prUrl,
      liveUrl,
      update,
    },
  };
}

/** What the agent says it ran, in one line — only the fields it filled in. */
function checksLine(summary: OrchestrationRun["summary"]): string | null {
  if (!summary) return null;
  const parts = [
    summary.tests && `tests: ${summary.tests}`,
    summary.tsc && `typecheck: ${summary.tsc}`,
    summary.lint && `lint: ${summary.lint}`,
  ].filter((p): p is string => !!p && !/^\w+: (n\/a|none|-)$/i.test(p));
  return parts.length ? parts.join(" · ") : null;
}
