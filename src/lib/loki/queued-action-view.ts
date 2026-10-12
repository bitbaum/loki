/**
 * What the chat says under an answer that queued an action, at each stage.
 *
 * An answer that drafted a message, an event or a commitment used to end in
 * a link: "Added to your approval queue — review to run it". Approving meant
 * leaving the conversation for the approvals page, finding the row, deciding,
 * and coming back to see whether it happened. The decision is one word; the
 * place to say it is under the answer that proposed it.
 *
 * Pure: (what the server says about the action, what the last tap returned)
 * in, the sentence and the buttons out — so every state is pinned by
 * scripts/test/loki-queued-action-view.ts, including the ones a person meets
 * only when something goes wrong (zone locked, already decided, executor
 * failed).
 *
 * The IRON RULE is untouched: approving here is the operator's explicit word,
 * sent to the same decision path the approvals page uses.
 */
import type { ActionStatus } from "@/lib/constants/statuses";

/** What the decision route returned on the last tap, if anything. */
export type QueuedActionResult = {
  executed?: boolean;
  deferred?: boolean;
  error?: string;
};

export type QueuedActionTone = "pending" | "positive" | "neutral" | "warning";

export type QueuedActionView = {
  tone: QueuedActionTone;
  /** One sentence, the title in it. */
  line: string;
  /** Approve / Not now are offered. */
  canDecide: boolean;
  /** Where to go for the rest: the approvals page, worded for this state. */
  reviewLabel: string | null;
};

export function queuedActionView(input: {
  title: string;
  /** Approved by a standing rule at proposal time: already running. */
  autoApproved: boolean;
  /** Null while unknown (loading, or the status lookup failed). */
  status: ActionStatus | null;
  /** The answer from this card's own last decision, when there was one. */
  result?: QueuedActionResult | null;
  /** The last tap was a decline. */
  declined?: boolean;
}): QueuedActionView {
  const { title, autoApproved, status, result, declined } = input;

  if (autoApproved) {
    return {
      tone: "positive",
      line: `Doing it now: ${title} — your standing approval covers this.`,
      canDecide: false,
      reviewLabel: "See it in Approvals",
    };
  }
  if (declined || status === "rejected") {
    return {
      tone: "neutral",
      line: `Declined: ${title}. Nothing was done.`,
      canDecide: false,
      reviewLabel: null,
    };
  }
  if (result?.error) {
    return {
      tone: "warning",
      line: `Approved, but it did not go through: ${result.error}`,
      canDecide: false,
      reviewLabel: "Retry from Approvals",
    };
  }
  if (result?.executed || status === "executed") {
    return { tone: "positive", line: `Done: ${title}.`, canDecide: false, reviewLabel: null };
  }
  if (result?.deferred || status === "approved") {
    return {
      tone: "neutral",
      line: `Approved: ${title}. Loki cannot carry this kind out by itself yet, so it waits in Approvals for you to finish.`,
      canDecide: false,
      reviewLabel: "Open Approvals",
    };
  }
  if (status === "expired") {
    return {
      tone: "neutral",
      line: `Expired: ${title}. Ask again if you still want it.`,
      canDecide: false,
      reviewLabel: null,
    };
  }
  // A draft — or a status we could not read, where offering the decision is
  // still right: the server refuses a decision on anything that is not a
  // draft, and the card then reads the real status back.
  return {
    tone: "pending",
    line: `Ready when you are: ${title}.`,
    canDecide: true,
    reviewLabel: "Review details",
  };
}
