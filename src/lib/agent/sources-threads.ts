/**
 * The operator's own recent chat threads, as records Loki can answer from.
 *
 * Asked "what did I ask you to do today, and did any of it get done?" on the
 * live site (2026-10-15), Loki answered that it had "no record of any specific
 * request" — while six threads that morning held exactly those requests. Each
 * thread knew only itself. For a person running many things at once, "catch
 * me up across my chats" is the question the rail exists to answer, and the
 * assistant beside the rail could not.
 *
 * One fact per thread active in the last week: what it is about, which
 * projects, where it stopped (the same words the rail shows, from
 * `deriveThreadState`) and its last message. The current thread is included —
 * it is one of the things the person did today.
 */
import { makeFact, type Fact } from "@bitbaum/ai-kit/grounding";
import type { ConversationListRow } from "@/db/queries/conversations";
import { deriveThreadState } from "@/lib/loki/thread-state";
import { agoLabel, excerpt, timeLabel } from "@/lib/agent/fact-utils";
import { DAY_MS } from "@/lib/constants/time";

/** How far back "recently" reaches for threads. */
export const THREAD_FACT_WINDOW_MS = 7 * DAY_MS;

type ThreadRow = Pick<
  ConversationListRow,
  | "id"
  | "title"
  | "projectKeys"
  | "updatedAt"
  | "lastReadAt"
  | "preview"
  | "lastRole"
  | "lastKind"
  | "lastAt"
  | "lastOk"
  | "lastOutcome"
  | "lastNeedsProject"
>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Where a thread stopped, in words — never blank, so the model never guesses. */
function stoppedAt(row: ThreadRow, now: number): string {
  const state = deriveThreadState(
    {
      lastRole: row.lastRole,
      lastKind: row.lastKind,
      lastAt: iso(row.lastAt),
      lastOk: row.lastOk,
      lastOutcome: row.lastOutcome,
      lastNeedsProject: row.lastNeedsProject,
      lastReadAt: iso(row.lastReadAt),
    },
    now,
  );
  if (state.label) return state.label;
  if (row.lastRole === "user") return "Waiting on Loki's answer";
  if (row.lastKind === "dispatch") return "Sent to an agent; no outcome recorded";
  return "Answered";
}

export function threadFact(row: ThreadRow, now: number = Date.now()): Fact {
  const at = row.lastAt ?? row.updatedAt;
  return makeFact({
    kind: "thread",
    subject: `chat thread "${row.title}"`,
    source: "conversations table (the operator's own Loki chats)",
    values: {
      title: row.title,
      projects: row.projectKeys.length > 0 ? row.projectKeys.join(", ") : "none",
      last_active: `${timeLabel(at)} (${agoLabel(at, new Date(now))})`,
      where_it_stopped: stoppedAt(row, now),
      last_message: `${row.lastRole === "user" ? "the operator" : "Loki"}: ${
        excerpt(row.preview, 160) ?? "(empty)"
      }`,
    },
  });
}

export function recentThreadFacts(rows: ThreadRow[], limit: number, now = Date.now()): Fact[] {
  return rows
    .filter((r) => now - (r.lastAt ?? r.updatedAt).getTime() <= THREAD_FACT_WINDOW_MS)
    .slice(0, limit)
    .map((r) => threadFact(r, now));
}

export async function threadFacts(userId: string, limit: number): Promise<Fact[]> {
  const { listConversations } = await import("@/db/queries/conversations");
  return recentThreadFacts(await listConversations(userId), limit);
}
