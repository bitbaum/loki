"use client";

import { useState, useMemo } from "react";
import { AlertTriangle, CircleAlert, Loader2, X } from "lucide-react";
import { List, ListRow } from "@/components/ui/list-row";
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

  // Rows, like everything else on Home (design reset, 2026-10): what went
  // wrong, why on the grey line, and the fix as the row's one button — never
  // a red card per failure.
  return (
    <div id="control-attention" className="scroll-mt-24">
      <List aria-label="Needs you">
        {groupedFailures.map((group) => {
          const f = group.representative;
          const remedy = remedyForFailure(f.error);
          const busy = retrying.has(f.id);
          const other =
            remedy === FAILURE_REMEDY.SWITCH_AGENT ? (switchFor?.(f.tab) ?? null) : null;
          const canStartSession =
            remedy === FAILURE_REMEDY.START_SESSION &&
            f.tab !== "unknown" &&
            Boolean(onStartSession);
          const fix = other
            ? { label: `Use ${other.label}`, run: () => void retry(group, other) }
            : canStartSession
              ? {
                  label: REMEDY_LABEL[FAILURE_REMEDY.START_SESSION],
                  run: () => onStartSession!(f.tab),
                }
              : remedy === FAILURE_REMEDY.RETRY || remedy === FAILURE_REMEDY.SWITCH_AGENT
                ? { label: REMEDY_LABEL[FAILURE_REMEDY.RETRY], run: () => void retry(group) }
                : null;
          const why = failedRetry.has(f.id)
            ? "That did not go through. Try once more, or start again from the box above."
            : failureBody(f.error);
          return (
            <ListRow
              key={f.id}
              icon={AlertTriangle}
              title={`${failureTitle(f)}${group.count > 1 ? ` · ${group.count} times` : ""}`}
              secondary={`${why} · ${timeAgo(new Date(f.executedAt).getTime())}`}
              status="negative"
              trailing={
                fix ? (
                  <button type="button" className="ui-home-fix" disabled={busy} onClick={fix.run}>
                    {busy && <Loader2 className="ui-spinner-sm" aria-hidden="true" />}
                    {fix.label}
                  </button>
                ) : undefined
              }
              menu={
                <button
                  type="button"
                  onClick={() => group.dismissIds.forEach(dismiss)}
                  className="ui-btn-icon"
                  aria-label="Dismiss"
                  title="Dismiss"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              }
            />
          );
        })}

        {items.map(({ project, reason }) => (
          <ListRow
            key={project.tab}
            icon={CircleAlert}
            title={project.tab}
            secondary={
              reason && reason.toLowerCase() !== "needs attention" ? reason : "Needs a look"
            }
            onClick={onFocusProject ? () => onFocusProject(project.tab) : undefined}
            chevron={Boolean(onFocusProject)}
          />
        ))}
      </List>
    </div>
  );
}
