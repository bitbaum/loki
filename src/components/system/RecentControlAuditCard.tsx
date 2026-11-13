import { ListChecks, PauseCircle, PlayCircle, Send, XCircle } from "lucide-react";
import { SystemBlock, SystemBlockHeader } from "./SystemBlock";
import { EmptyState } from "@/components/ui/empty-state";
import { getRecentControlAuditEvents } from "@/db/queries/control-audit-events";
import { compactRelativeDate } from "@/lib/dates";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { projectTitle } from "@/lib/project-display";

/** The audit's action id as a word a person uses ("queued" → "Waiting to start"). */
function decisionWord(action: string): string {
  return EXECUTOR_COPY.decision[action] ?? action.replace(/_/g, " ");
}

const ICONS = {
  off: PauseCircle,
  refused: PauseCircle,
  failed: XCircle,
  queued: Send,
  injected: Send,
  queue: Send,
  composed: Send,
  nextbest: PlayCircle,
};

export async function RecentControlAuditCard({ userId }: { userId: string }) {
  const rows = await getRecentControlAuditEvents(userId, 12).catch(() => []);
  const blocked = rows.filter((r) => r.action === "off" || r.action === "refused").length;

  return (
    <SystemBlock>
      <SystemBlockHeader
        icon={ListChecks}
        title="What Loki decided"
        right={
          blocked > 0 ? (
            <span className="text-xs text-text-tertiary">{blocked} refused</span>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState>No control decisions recorded yet</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const Icon = ICONS[row.action as keyof typeof ICONS] ?? ListChecks;
            // What was asked says what this was; the reason leads only when
            // the decision was a refusal or a failure.
            const stopped =
              row.action === "refused" || row.action === "off" || row.action === "failed";
            const text =
              (stopped ? (row.reason ?? row.promptPreview) : (row.promptPreview ?? row.reason)) ??
              "";
            return (
              // Same shape as RecentFailuresCard: three fixed-width labels
              // ahead of the one field that says WHY, on a line that cannot
              // wrap. The reason gets its own line on a phone.
              <li key={row.id} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-xs">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                <span className="shrink-0 font-mono text-text-tertiary">
                  {compactRelativeDate(row.createdAt)}
                </span>
                <span className="shrink-0 text-text-muted">
                  {row.projectKey ? projectTitle({ name: row.projectKey }) : "Loki"}
                </span>
                <span className="shrink-0 font-medium text-text-primary">
                  {decisionWord(row.action)}
                </span>
                <span
                  className="line-clamp-2 w-full min-w-0 text-text-secondary sm:w-auto sm:flex-1"
                  title={text}
                >
                  {text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SystemBlock>
  );
}
