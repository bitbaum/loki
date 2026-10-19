"use client";

import { useState, useMemo } from "react";
import { AlertTriangle, RotateCcw, Play, X } from "lucide-react";
import { remedyForFailure, FAILURE_REMEDY, REMEDY_LABEL } from "@/lib/failure-remedy";
import type { AttentionItem } from "./control-presenter";
import type { FailedCommand } from "@/lib/control-types";
import { HEALTH_TAG_STYLE } from "@/config/ui";
import { timeAgo } from "@/lib/dates";
import { postJson } from "@/lib/api/fetch";
import { CONTROL_DISMISSED_FAILURES_KEY } from "@/config/brand-storage";
import { fleetSurfaceHref } from "@/lib/fleet-context";

/** Group consecutive failures that match on (type, tab, error). Stops the
 *  "three identical error rows" stacking that happens when the user clicks
 *  Send → fail → Send → fail. Each group keeps the most recent id (so
 *  dismiss still works) and a count of how many failures collapsed into it. */
type FailureGroup = {
  representative: FailedCommand;
  count: number;
  dismissIds: string[];
};

function groupConsecutive(items: FailedCommand[]): FailureGroup[] {
  const groups: FailureGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.representative.type === item.type &&
      last.representative.tab === item.tab &&
      last.representative.error === item.error
    ) {
      last.count++;
      last.dismissIds.push(item.id);
    } else {
      groups.push({ representative: item, count: 1, dismissIds: [item.id] });
    }
  }
  return groups;
}

export function AttentionBar({
  items,
  failedCommands,
  onFocusProject,
  onStartSession,
}: {
  items: AttentionItem[];
  failedCommands?: FailedCommand[];
  onFocusProject?: (tab: string) => void;
  /** Start a session for a project whose failure cannot be retried into
   *  existence. Optional: without it the row falls back to showing nothing
   *  rather than a button that cannot work. */
  onStartSession?: (tab: string) => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(CONTROL_DISMISSED_FAILURES_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      try {
        localStorage.setItem(CONTROL_DISMISSED_FAILURES_KEY, JSON.stringify([...next]));
      } catch {
        /* */
      }
      return next;
    });
  };

  // Re-enqueues the representative command verbatim; on success the whole
  // group is dismissed (the retried command reports its own outcome).
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const retry = async (group: FailureGroup) => {
    const id = group.representative.id;
    setRetrying((prev) => new Set(prev).add(id));
    try {
      const res = await postJson(`/api/control/commands/${id}/retry`, {});
      if (res.ok) group.dismissIds.forEach(dismiss);
    } catch {
      /* failure stays visible for another attempt */
    }
    setRetrying((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const visibleFailures = (failedCommands ?? []).filter((f) => !dismissed.has(f.id));
  const groupedFailures = useMemo(() => groupConsecutive(visibleFailures), [visibleFailures]);

  if (items.length === 0 && groupedFailures.length === 0) return null;

  return (
    <div id="control-attention" className="flex scroll-mt-24 flex-col gap-2">
      {items.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border-l-2 border-status-warning border-t border-r border-b border-border-subtle bg-surface-base px-4 py-3">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-status-warning" />
          <div className="flex flex-wrap gap-2 min-w-0">
            <span className="text-xs text-text-secondary font-medium shrink-0 mt-0.5">
              Needs attention:
            </span>
            {items.map(({ project, reason }) => {
              const healthKey = (
                project.session?.health ??
                project.latestOrchestrationRun?.summary?.health ??
                ""
              ).toLowerCase();
              const tagCls = HEALTH_TAG_STYLE[healthKey] ?? "ui-tag ui-tag-warning";
              // Reason chip only adds value when distinct from the bar's
              // "Needs attention:" prefix; the literal phrase just repeats it.
              const showReasonChip = reason && reason.toLowerCase() !== "needs attention";
              return (
                <span key={project.tab} className="flex items-center gap-1.5 shrink-0">
                  {onFocusProject ? (
                    <button
                      onClick={() => onFocusProject(project.tab)}
                      className="text-xs font-medium text-text-primary underline-offset-2 hover:underline transition-colors"
                    >
                      {project.tab}
                    </button>
                  ) : (
                    <span className="text-xs font-medium text-text-primary">{project.tab}</span>
                  )}
                  {showReasonChip && <span className={tagCls}>{reason}</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {groupedFailures.map((group) => {
        const f = group.representative;
        // "delivered" was polite fiction when verified=false — the prompt hit a
        // PTY but the agent never generated. Say that plainly.
        const verb = f.unverified ? "queued, not confirmed working" : "failed";
        // A Retry is only offered when repeating the identical command could
        // produce a different result. "No running agent" cannot: the target is
        // identically absent on every attempt, which is how this exact banner
        // sat on /control for 47 minutes wearing a button that never worked.
        const remedy = remedyForFailure(f.error);
        const canStartSession =
          remedy === FAILURE_REMEDY.START_SESSION && f.tab !== "unknown" && Boolean(onStartSession);
        return (
          <div key={f.id} className="ui-callout-negative justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-status-negative" />
              <span className="text-xs text-text-primary">
                <span className="font-medium">{f.type}</span>
                {f.tab !== "unknown" && (
                  <>
                    {" "}
                    → <span className="font-medium">{f.tab}</span>
                  </>
                )}
                {` ${verb}: `}
                <span className="text-text-secondary">{f.error}</span>
                {group.count > 1 && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-status-negative/10 px-1.5 py-0.5 text-micro font-semibold text-status-negative">
                    ×{group.count}
                  </span>
                )}
                <span className="ml-2 text-text-muted">
                  {timeAgo(new Date(f.executedAt).getTime())}
                </span>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {f.tab !== "unknown" && (
                <a
                  href={fleetSurfaceHref("control", f.tab)}
                  className="ui-btn-ghost ui-btn-xs text-micro"
                  title={`Focus ${f.tab} on Home — Terminal stays empty unless a session is actually running`}
                >
                  Open on Control
                </a>
              )}
              {canStartSession && (
                <button
                  onClick={() => onStartSession!(f.tab)}
                  className="ui-btn-ghost ui-btn-xs gap-1 text-micro"
                  aria-label={`Start a session for ${f.tab}`}
                  title={`${f.tab} has no terminal session — start one, then this command can run`}
                >
                  <Play className="h-3 w-3" />
                  {REMEDY_LABEL[FAILURE_REMEDY.START_SESSION]}
                </button>
              )}
              {remedy === FAILURE_REMEDY.RETRY && (
                <button
                  onClick={() => retry(group)}
                  disabled={retrying.has(f.id)}
                  className="ui-btn-ghost ui-btn-xs gap-1 text-micro"
                  aria-label="Retry command"
                >
                  <RotateCcw className="h-3 w-3" />
                  {retrying.has(f.id) ? "Retrying…" : REMEDY_LABEL[FAILURE_REMEDY.RETRY]}
                </button>
              )}
              <button
                onClick={() => group.dismissIds.forEach(dismiss)}
                className="ui-tap-icon text-text-muted hover:text-text-secondary transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
