/**
 * Reporter rows for /my-feedback: honest phase in, operator internals out.
 *
 * Deliberately NOT attachFeedbackWork. That function is the operator's path
 * and does far more than read: it refreshes fix ledgers against GitHub, sends
 * "your fix shipped" notifications, reads builder presence and queue blockers,
 * and scopes every one of those to the owner's user id. Running it for a
 * reporter would be wrong twice over — it would return nothing (the runs
 * belong to the project's owner, not the reporter) and it would fire the
 * owner's side effects on a stranger's page load.
 *
 * So this is the narrow read: the run rows behind the reporter's own reports,
 * the phase derived from them, and a reporter-safe view of that phase. No
 * presence lookup, no ledger refresh, no notifications, no writes.
 *
 * One consequence worth keeping on purpose: without applyRunContext the
 * snapshot carries no `builderOffline` or `builderChannel`, so the phase layer
 * cannot produce a builder ask ("Open Fleet Runner on This computer") even by
 * accident. The reporter gets the phase; the machine stays the operator's.
 */
import { getRunsByIdsForReporter } from "@/db/queries/orchestration-runs";
import { runToFeedbackSnapshot } from "@/lib/feedback/attach-work";
import { deriveFeedbackWork } from "@/lib/feedback/work-phase";
import { livePageHref } from "@/lib/feedback/fix-shipping";
import { reporterStatusFor, type ReporterStatus } from "@/lib/feedback/reporter-view";
import type { UserFeedbackListItem } from "@/db/queries/site-feedback";

export type ReporterFeedbackRow = {
  id: string;
  projectName: string;
  suggestion: string;
  createdAt: Date;
  status: ReporterStatus;
};

/**
 * Narrow the rows to what the page renders. The full list item carries the
 * owner's fields (dispatchedRunId, userId, contentHash, selectedElements…);
 * mapping to an explicit shape here means a column added to site_feedback
 * cannot reach a reporter's browser just because the page spread the row.
 */
export async function attachReporterView(
  items: UserFeedbackListItem[],
): Promise<ReporterFeedbackRow[]> {
  const runIds = [
    ...new Set(items.map((i) => i.dispatchedRunId).filter((id): id is string => !!id)),
  ];
  const runs = await getRunsByIdsForReporter(runIds);

  return items.map((item) => {
    const run = item.dispatchedRunId ? runs.get(item.dispatchedRunId) : null;
    const work = deriveFeedbackWork(item.status, runToFeedbackSnapshot(run));
    const liveHref = livePageHref(item.liveUrl, item.url, item.page);
    return {
      id: item.id,
      projectName: item.projectName,
      suggestion: item.suggestion,
      createdAt: item.createdAt,
      status: reporterStatusFor(work, { liveHref }),
    };
  });
}
