"use client";

import { ArrowRight } from "lucide-react";
import { deriveThreadState, type ThreadStateKind } from "@/lib/loki/thread-state";
import { stateInputOf } from "./ThreadRail";
import type { ConversationSummary } from "./types";

type Item = { kind: ThreadStateKind; label: string; id: string };

/**
 * The start screen's inbox line: "1 needs you · 2 running · 3 came back",
 * each part a tap into the first thread in that state. Renders nothing when
 * there is nothing to say — a line of zeros is noise under the greeting.
 */
export function ThreadInbox({
  conversations,
  onOpen,
}: {
  conversations: ConversationSummary[];
  onOpen: (id: string) => void;
}) {
  const buckets: Record<"needs-you" | "running" | "done", string[]> = {
    "needs-you": [],
    running: [],
    done: [],
  };
  for (const c of conversations) {
    const { kind } = deriveThreadState(stateInputOf(c));
    if (kind === "needs-you") buckets["needs-you"].push(c.id);
    else if (kind === "running") buckets.running.push(c.id);
    else if (kind === "done" || kind === "unread") buckets.done.push(c.id);
  }
  const items: Item[] = [];
  const n = buckets["needs-you"].length;
  if (n > 0)
    items.push({
      kind: "needs-you",
      label: `${n} need${n === 1 ? "s" : ""} you`,
      id: buckets["needs-you"][0]!,
    });
  if (buckets.running.length > 0) {
    items.push({
      kind: "running",
      label: `${buckets.running.length} running`,
      id: buckets.running[0]!,
    });
  }
  if (buckets.done.length > 0) {
    items.push({ kind: "done", label: `${buckets.done.length} came back`, id: buckets.done[0]! });
  }
  if (items.length === 0) return null;

  return (
    <nav aria-label="What needs you" className="ui-loki-start-inbox">
      {items.map((item) => (
        <button
          key={item.kind}
          type="button"
          className={
            item.kind === "needs-you"
              ? "ui-loki-start-inbox-item ui-loki-start-inbox-needs"
              : "ui-loki-start-inbox-item"
          }
          onClick={() => onOpen(item.id)}
        >
          {item.label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      ))}
    </nav>
  );
}
