/**
 * The last message in a thread is the person's, and nothing is answering it.
 *
 * A turn dies with its connection: closing or reloading the page mid-answer
 * stops the model call, exactly as Stop does (lib/api/sse). The question is
 * already stored, so the reopened thread showed it with nothing under it: no
 * "working", no answer ever, and no way to ask again (measured 2026-11-13:
 * still nothing thirty seconds and a second reload later). A question left
 * hanging is a dead end; this finds it so the thread can say so and offer
 * Try again.
 */
import { unansweredTurn as chatkitUnansweredTurn } from "@bitbaum/chatkit";

export interface ThreadMessageLike {
  id: string;
  role: string;
  content: string;
}

export const UNANSWERED_TEXT =
  "Loki did not finish answering this. The page was closed or the answer was stopped before it was done.";

export function unansweredTurn(
  messages: readonly ThreadMessageLike[],
  state: { sending: boolean; loading: boolean; queued: number },
): { id: string; text: string } | null {
  // The rule is the package's. Loki marks a send still in flight by its id.
  return chatkitUnansweredTurn(
    messages.map((m) => ({ ...m, pending: m.id.startsWith("pending-") })),
    state,
  );
}
