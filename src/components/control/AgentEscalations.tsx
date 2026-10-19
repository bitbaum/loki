"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { NAV } from "@/config/navigation";
import { patchJson } from "@/lib/api/fetch";
import type { AgentMessage } from "@/lib/agent-comms";

type CommsResp = { messages: AgentMessage[] };

/**
 * The only Agents fact that earns space on Control: an unread escalation.
 * Renders nothing when the bus is quiet — no essay, no empty feed, no tab.
 *
 * The banner filters on `!m.read`, and until now NOTHING could write
 * `read: true`: `markAgentMessageRead` had no caller and no route, so the first
 * escalation to arrive stayed on Control permanently. A notice you cannot clear
 * stops being a notice — it becomes furniture, and the next real one lands
 * behind it unnoticed. Hence a dismiss.
 */
export function AgentEscalations() {
  const { data } = useFetch<CommsResp>("/api/agents/comms");
  // Dismissed here as well as on the server: the feed polls on an interval, so
  // without a local set the row would sit there until the next fetch lands.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const items = (data?.messages ?? []).filter(
    (m) => m.type === "escalation" && !m.read && !dismissed.has(m.id),
  );
  if (items.length === 0) return null;

  async function dismiss(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
    try {
      await patchJson("/api/agents/comms", { msgId: id });
    } catch {
      // Put it back rather than pretend: an escalation that silently vanished
      // on a failed write is worse than one that is still here.
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border-subtle border-l-2 border-l-status-negative bg-surface-base px-4 py-3">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-negative" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-text-secondary">Agent escalation</p>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {items.slice(0, 3).map((m) => (
            <li key={m.id} className="flex min-w-0 items-start gap-2">
              <Link
                href={`${NAV.control.href}?project=${encodeURIComponent(m.from)}`}
                className="ui-tap block min-w-0 flex-1 text-sm text-text-primary"
              >
                <span className="font-medium">{m.from}</span>
                <span className="text-text-muted"> → {m.to}</span>
                {/* The escalation's actual message, at 16% visible on one
                    nowrap line. `block` is deliberately GONE, not merely
                    joined by line-clamp: a display utility overrides
                    -webkit-box and leaves the clamp declared but inert — the
                    bug this repo has now shipped three times. */}
                {(m.re || m.body) && (
                  <span className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
                    {m.re || m.body}
                  </span>
                )}
              </Link>
              <button
                type="button"
                onClick={() => void dismiss(m.id)}
                className="ui-btn-icon shrink-0"
                aria-label={`Dismiss escalation from ${m.from}`}
                title="Mark read — removes it from Home"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
