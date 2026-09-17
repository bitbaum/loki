/**
 * Shared producer step: message → extracted proposal → queued draft action.
 *
 * Kept separate from extract-proposal.ts (which stays DB-free so its parse/validate
 * core is unit-testable) because this touches the DB. Both chat surfaces — the
 * quick-ask /api/loki route and the main /api/conversations/[id]/messages route —
 * call this so the queue's producer lives in exactly one place.
 *
 * Fully best-effort: extraction or the queue write failing just means "nothing
 * queued this turn" — it must never break the chat reply. The IRON RULE holds:
 * everything enters as status='draft' and only the operator's approval moves it
 * — given per item, or in advance via a standing rule (lib/actions/standing-approval.ts).
 */
import type { ActionType } from "@/lib/constants/statuses";
import { ACTION_TYPE } from "@/lib/constants/statuses";
import { extractActionProposal } from "@/lib/actions/extract-proposal";
import { enqueueAction } from "@/lib/actions/enqueue-action";
import { enrichReachPayload, reachFromPerson, resolvePersonToReach } from "@/lib/people-resolve";

export type QueuedActionSummary = {
  id: string;
  type: ActionType;
  title: string;
  /**
   * A standing rule approved it and it is already running — so the chat UI must
   * say "done", not "queued for approval". The queue's whole value is that its
   * status line is true; a summary that cannot express "already done" would
   * make the UI report a completed booking as still awaiting a decision.
   */
  autoApproved: boolean;
};

/**
 * Detect an actionable request in `rawMessage`, enqueue it, and return a summary
 * for the UI. Returns null when there's nothing to queue OR when the draft
 * dedupes against an already-pending one (so the UI never claims a duplicate
 * add). `nowISO` anchors relative dates — the caller passes the clock.
 */
export async function enqueueProposalFromMessage(
  userId: string,
  rawMessage: string,
  nowISO: string,
): Promise<QueuedActionSummary | null> {
  const proposal = await extractActionProposal(rawMessage, nowISO).catch(() => null);
  if (!proposal) return null;

  const hint = typeof proposal.payload?.to === "string" ? proposal.payload.to : undefined;
  const person =
    proposal.type === ACTION_TYPE.SEND_MESSAGE || proposal.type === ACTION_TYPE.SEND_EMAIL
      ? await resolvePersonToReach(userId, hint, rawMessage).catch(() => null)
      : null;
  const reach = person ? reachFromPerson(person) : null;

  const outcome = await enqueueAction(userId, {
    type: proposal.type,
    title:
      person &&
      (proposal.type === ACTION_TYPE.SEND_MESSAGE || proposal.type === ACTION_TYPE.SEND_EMAIL)
        ? `Message ${person.name}`.slice(0, 200)
        : proposal.title,
    description: proposal.description,
    payload: enrichReachPayload(proposal.payload, reach),
    reasoning: person
      ? `Matched ${person.name}${reach ? ` on ${reach.channel}` : ""}.`
      : (proposal.reasoning ?? "Proposed by Loki from chat — approve to run it."),
    entityId: person?.id ?? null,
  });
  // An already-pending draft title dedupes — nothing new was queued.
  if (outcome.result === "deduped") return null;

  // No Telegram card from this producer: the operator is looking at the web
  // chat that produced it, and the reply already says what was queued. Pinging
  // the phone about something on the screen in front of you is the storm.
  const action = outcome.action;
  return {
    id: action.id,
    type: action.type,
    title: action.title,
    autoApproved: outcome.result === "auto",
  };
}
