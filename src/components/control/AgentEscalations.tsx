"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { List, ListRow } from "@/components/ui/list-row";
import { projectTitle } from "@/lib/project-display";
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

  // Rows under Home's "Needs you" (design reset, 2026-10), not a red-edged
  // card of its own: who escalated, their words on the grey line, × to mark
  // it read.
  return (
    <List aria-label="Agent escalations">
      {items.slice(0, 3).map((m) => (
        <ListRow
          key={m.id}
          href={`${NAV.control.href}?project=${encodeURIComponent(m.from)}`}
          icon={AlertTriangle}
          title={`${projectTitle({ name: m.from })} needs a decision`}
          secondary={m.re || m.body || `Escalated to ${m.to}`}
          status="negative"
          menu={
            <button
              type="button"
              onClick={() => void dismiss(m.id)}
              className="ui-btn-icon"
              aria-label={`Dismiss escalation from ${projectTitle({ name: m.from })}`}
              title="Mark read — removes it from Home"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          }
        />
      ))}
    </List>
  );
}
