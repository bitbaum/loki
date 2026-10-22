import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { SystemBlock, SystemBlockHeader } from "./SystemBlock";
import { EmptyState } from "@/components/ui/empty-state";
import { getRecentDebugLogs } from "@/db/queries/debug-logs";
import { compactRelativeDate } from "@/lib/dates";

/**
 * Surfaces the last ~10 debug_logs rows on /system so the user can see live
 * telemetry without querying the DB manually. Sources currently emitting:
 *   - api/inject               (unknown tab, route-level 401, exec failure)
 *   - api/orchestration/run    (claude/codex/gemini inject + openclaw worker)
 *   - api/control/dispatch     (Groq fallback)
 *   - crons/prune-debug-logs (daily janitor heartbeat)
 *   - auth                     (Auth.js signIn errors and org-bootstrap fails)
 *
 * Server-component reads — no client poll, no fetch — re-renders whenever
 * the page revalidates (PullToRefresh or RefreshOnFocus).
 */

const LEVEL_TONE: Record<string, { icon: typeof Info; cls: string }> = {
  error: { icon: AlertCircle, cls: "text-status-negative" },
  warn: { icon: AlertTriangle, cls: "text-status-warning" },
  info: { icon: Info, cls: "text-text-tertiary" },
};

export async function RecentFailuresCard() {
  const rows = await getRecentDebugLogs(10).catch(() => []);
  const errorCount = rows.filter((r) => r.level === "error").length;
  const warnCount = rows.filter((r) => r.level === "warn").length;
  // Previously read errorCount only and showed "all clear" whenever no
  // errors existed — but 10 warning rows visible directly below
  // contradicted the badge. Caught live on cloud /system: 10 groq 401
  // warnings rendered under an "all clear" header. Surface warnings in
  // the badge too; reserve "all clear" for genuinely empty problem state.
  const right =
    errorCount > 0 ? (
      <span className="text-xs font-medium text-status-negative">
        {errorCount} error{errorCount === 1 ? "" : "s"}
      </span>
    ) : warnCount > 0 ? (
      <span className="text-xs font-medium text-status-warning">
        {warnCount} warning{warnCount === 1 ? "" : "s"}
      </span>
    ) : (
      <span className="text-xs text-text-tertiary">all clear</span>
    );

  return (
    <SystemBlock>
      <SystemBlockHeader icon={AlertCircle} title="Recent errors" right={right} />
      {rows.length === 0 ? (
        <EmptyState>No recent telemetry events</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const tone = LEVEL_TONE[row.level] ?? LEVEL_TONE.info;
            const Icon = tone.icon;
            return (
              // The message is the only part of this row that says what
              // happened, and it was last in a single nowrap line after a
              // timestamp and a source — so at 320px it rendered 0% of itself
              // (-596px), and the rest was hover-only on a device with no
              // hover. It now wraps to its own full-width line below the meta
              // on a phone and stays inline from `sm` up.
              <li key={row.id} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-xs">
                <Icon className={`mt-0.5 h-3 w-3 shrink-0 ${tone.cls}`} />
                <span className="shrink-0 font-mono text-text-tertiary">
                  {compactRelativeDate(row.createdAt)}
                </span>
                <span className="shrink-0 text-text-muted">{row.source}</span>
                <span
                  className="line-clamp-2 w-full min-w-0 text-text-secondary sm:w-auto sm:flex-1"
                  title={row.message}
                >
                  {row.message}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SystemBlock>
  );
}
