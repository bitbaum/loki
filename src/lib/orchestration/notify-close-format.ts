import { ORCHESTRATION_OUTCOME } from "@/db/schema/orchestration-runs";
import type { OrchestrationRun } from "@/db/schema/orchestration-runs";
import { runReportText } from "@/lib/orchestration/summary";
import { APP_URL } from "@/config/brand";

/** Longest summary/error excerpt a close notification carries into chat. */
const SUMMARY_MAX_CHARS = 600;

/**
 * Should a dispatch made by this actor announce its outcome?
 *
 * The rule in one line: a person gets told, a machine does not.
 *
 * "via" comes from how the request authenticated — a cookie session is the web
 * UI, a Bearer token is a runner, a hook, or a scheduled loop. That is a real
 * signal about who is waiting, and it beats the alternative of maintaining a
 * list of "automated" call sites that every new one silently joins.
 *
 * Lives here, pure and shared, because the two dispatch routes were each about
 * to inline `actor.via === "session"` — two copies of a product rule that must
 * not drift, and neither testable where it sat.
 */
export function shouldAnnounceOnClose(
  actor: { via: "session" | "token" } | null | undefined,
  explicit?: boolean,
): boolean {
  // An explicit value from the caller always wins, in either direction: chat
  // dispatches opt in deliberately, and an automation may ask to be announced.
  if (typeof explicit === "boolean") return explicit;
  return actor?.via === "session";
}

/**
 * Pure half of the chat close notification (see notify-close.ts): decide
 * whether this run notifies and what the message says. Returns null for runs
 * that didn't opt in (or that aren't actually closed) so the caller can skip
 * the send entirely. Kept free of infra imports (no db, no fetch) so
 * scripts/test/notify-close.ts can cover it without a database.
 */
export function formatRunCloseMessage(
  run: Pick<OrchestrationRun, "projectKey" | "outcome" | "finishedAt" | "payload" | "summary">,
): string | null {
  if (!run.payload?.notifyOnClose || !run.finishedAt) return null;
  const ok = run.outcome === ORCHESTRATION_OUTCOME.SUCCESS;
  const icon = ok ? "✅" : run.outcome === ORCHESTRATION_OUTCOME.PARTIAL ? "🟡" : "❌";
  const summary = runReportText(run);
  const lines = [
    `${icon} ${run.projectKey}: run ${run.outcome ?? "closed"}`,
    ...(summary ? [summary.slice(0, SUMMARY_MAX_CHARS)] : []),
  ];
  return lines.join("\n");
}

/**
 * The way forward under a run that did not succeed.
 *
 * "❌ loki: run error … choose another AI provider and Retry" arrived on
 * Telegram with nothing to tap (2026-10-12): it named a Retry the message
 * itself could not reach. The project's card on Control is where Retry and the
 * provider switch live, so the message links straight to it. A success needs
 * no button — there is nothing left to do.
 */
export function runCloseButtons(
  run: Pick<OrchestrationRun, "projectKey" | "outcome">,
): { text: string; url: string }[][] {
  if (run.outcome === ORCHESTRATION_OUTCOME.SUCCESS) return [];
  return [
    [
      {
        text: `Open ${run.projectKey} in Control`,
        url: `${APP_URL}/control?focus=${encodeURIComponent(run.projectKey)}`,
      },
    ],
  ];
}
