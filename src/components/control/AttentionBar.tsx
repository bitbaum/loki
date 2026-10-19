"use client";

import { useState, useMemo } from "react";
import { AlertTriangle, ChevronRight, Loader2, Play, RotateCcw, X } from "lucide-react";
import { remedyForFailure, FAILURE_REMEDY, REMEDY_LABEL } from "@/lib/failure-remedy";
import type { AttentionItem } from "./control-presenter";
import type { FailedCommand } from "@/lib/control-types";
import { timeAgo } from "@/lib/dates";
import { postJson } from "@/lib/api/fetch";
import { CONTROL_DISMISSED_FAILURES_KEY } from "@/config/brand-storage";

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

/** What the failed command was trying to do, in words a person would use. */
function failureTitle(f: FailedCommand): string {
  const where = f.tab !== "unknown" ? f.tab : "a project";
  if (f.unverified) return `Sent to ${where}, but the agent did not start`;
  if (f.type === "dispatch") return `Couldn't start work in ${where}`;
  if (f.type === "launch_agent") return `Couldn't open a session in ${where}`;
  if (f.type === "switch_agent") return `Couldn't change the agent in ${where}`;
  if (/inject/.test(f.type)) return `Couldn't send your message to ${where}`;
  return `Something didn't run in ${where}`;
}

/** The error, without the advice the buttons below already give. */
function failureBody(error: string): string {
  return error.replace(/\s*Switch this project to an agent installed there[\s\S]*$/, "").trim();
}

/** An agent the project's builder HAS, for "Use … instead". */
export type AgentSwitch = { id: string; label: string };

/**
 * What needs you on Home, each with its way out on the same card.
 *
 * It was a red callout per failure with the text squeezed into a column a
 * third of the screen wide, beside "Open on Control" (the page it was already
 * on) and Retry — which, for "Grok is not installed on the cloud builder",
 * fails the same way every time (owner, 2026-10-19: "everything like that
 * should provide a user opportunity to fix it. Right there"). Now: a title in
 * words, the reason under it, and the fix as the card's one button —
 * "Use Claude instead" re-runs the same work on an agent that builder has and
 * makes it the project's agent; Start session for a missing session; Retry
 * only where trying again could change something.
 */
export function AttentionBar({
  items,
  failedCommands,
  onFocusProject,
  onStartSession,
  switchFor,
  onSwitchAgent,
}: {
  items: AttentionItem[];
  failedCommands?: FailedCommand[];
  onFocusProject?: (tab: string) => void;
  /** Start a session for a project whose failure cannot be retried into
   *  existence. Optional: without it the row falls back to showing nothing
   *  rather than a button that cannot work. */
  onStartSession?: (tab: string) => void;
  /** The agent to offer instead when the project's agent is not installed. */
  switchFor?: (tab: string) => AgentSwitch | null;
  /** Make the switch stick: the project's agent from now on. */
  onSwitchAgent?: (tab: string, agent: string) => void;
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

  // Re-enqueues the representative command (with another agent when asked);
  // on success the whole group is dismissed — the new run reports its own
  // outcome under "Being built now".
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [failedRetry, setFailedRetry] = useState<Set<string>>(new Set());
  const retry = async (group: FailureGroup, agent?: AgentSwitch) => {
    const id = group.representative.id;
    setRetrying((prev) => new Set(prev).add(id));
    try {
      const res = await postJson(
        `/api/control/commands/${id}/retry`,
        agent ? { agent: agent.id } : {},
      );
      if (res.ok) {
        if (agent) onSwitchAgent?.(group.representative.tab, agent.id);
        group.dismissIds.forEach(dismiss);
      } else setFailedRetry((prev) => new Set(prev).add(id));
    } catch {
      setFailedRetry((prev) => new Set(prev).add(id));
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
    <section id="control-attention" className="ui-needs scroll-mt-24" aria-label="Needs you">
      {groupedFailures.map((group) => {
        const f = group.representative;
        const remedy = remedyForFailure(f.error);
        const busy = retrying.has(f.id);
        const other = remedy === FAILURE_REMEDY.SWITCH_AGENT ? (switchFor?.(f.tab) ?? null) : null;
        const canStartSession =
          remedy === FAILURE_REMEDY.START_SESSION && f.tab !== "unknown" && Boolean(onStartSession);
        return (
          <article key={f.id} className="ui-needs-card">
            <div className="ui-needs-head">
              <AlertTriangle className="ui-needs-icon" aria-hidden="true" />
              <h3 className="ui-needs-title">
                {failureTitle(f)}
                {group.count > 1 && <span className="ui-needs-times"> · {group.count} times</span>}
              </h3>
              <button
                type="button"
                onClick={() => group.dismissIds.forEach(dismiss)}
                className="ui-needs-dismiss"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="ui-needs-body">
              {failureBody(f.error)}{" "}
              <span className="ui-needs-when">{timeAgo(new Date(f.executedAt).getTime())}</span>
            </p>
            {failedRetry.has(f.id) && (
              <p className="ui-error" role="status">
                That did not go through. Try once more, or dismiss this and start again from the box
                above.
              </p>
            )}
            <div className="ui-needs-actions">
              {other ? (
                <button
                  type="button"
                  className="ui-btn-primary min-h-11"
                  disabled={busy}
                  onClick={() => void retry(group, other)}
                >
                  {busy ? <Loader2 className="ui-spinner-sm" aria-hidden="true" /> : null}
                  Use {other.label} instead
                </button>
              ) : canStartSession ? (
                <button
                  type="button"
                  onClick={() => onStartSession!(f.tab)}
                  className="ui-btn-primary min-h-11"
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {REMEDY_LABEL[FAILURE_REMEDY.START_SESSION]}
                </button>
              ) : remedy === FAILURE_REMEDY.RETRY || remedy === FAILURE_REMEDY.SWITCH_AGENT ? (
                <button
                  type="button"
                  onClick={() => void retry(group)}
                  disabled={busy}
                  className="ui-btn-primary min-h-11"
                >
                  {busy ? (
                    <Loader2 className="ui-spinner-sm" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  )}
                  {REMEDY_LABEL[FAILURE_REMEDY.RETRY]}
                </button>
              ) : null}
            </div>
          </article>
        );
      })}

      {items.length > 0 && (
        <div className="ui-needs-list">
          {items.map(({ project, reason }) => (
            <button
              key={project.tab}
              type="button"
              className="ui-needs-row"
              onClick={() => onFocusProject?.(project.tab)}
              disabled={!onFocusProject}
            >
              <span className="min-w-0 flex-1 text-left">
                <span className="ui-needs-row-name">{project.tab}</span>
                {reason && reason.toLowerCase() !== "needs attention" && (
                  <span className="ui-needs-row-why">{reason}</span>
                )}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
