/**
 * Standing approvals — approval given once, in advance, instead of per item.
 *
 * WHAT CHANGED AND WHY
 * The IRON RULE was "nothing executes that the operator did not approve". It
 * was implemented as "nothing executes that the operator did not TAP", and the
 * two are not the same rule. Booking an appointment in your own calendar is
 * private, self-only and undone by deleting it — yet it cost a context switch
 * out of the chat, a login, and a click, every single time. Observed 2026-08-04:
 * an event proposed at 14:15 was approved at 21:02 because nobody was looking
 * at the queue. The gate was not protecting anything there; it was just latency.
 *
 * So the rule is restated, not weakened:
 *
 *   Nothing executes without the operator's approval. Approval is given either
 *   per item (a tap) or as a STANDING RULE the operator set in advance for one
 *   action type. There is still no bypass — an action with no approval of
 *   either kind does not run.
 *
 * WHAT KEEPS THIS SAFE — three rails, in this file, not in a docblock:
 *
 *  1. ELIGIBILITY IS HARD-CODED. Only types whose worst case is private and
 *     reversible can ever carry a standing rule. A stored preference naming
 *     `send_email` is ignored, not obeyed: widening the set is an edit here,
 *     reviewed, and never a row someone can write into the database.
 *  2. THE PAYLOAD IS RE-CHECKED AT DECISION TIME. A calendar event is only
 *     "private and reversible" while it has no attendees — with them it emits
 *     real invitations to real people, which is outward-facing and not
 *     undoable. Those fall back to the queue regardless of the rule.
 *  3. UNKNOWN IS NOT YES. An event with no resolvable time cannot be booked
 *     correctly, so it is exactly the case a human should look at. It queues.
 *
 * Every auto-approval is audited like a tap (`approved`, via `standing-rule`)
 * and announced on Telegram, so the operator still sees what was done in their
 * name and can undo it. Silence is what would make this dangerous.
 */
import { ACTION_TYPE, type ActionType } from "@/lib/constants/statuses";
import type { ActionPayload } from "@/db/schema/actions";
import { isEventSlotPassed, resolveEventTimes } from "@/lib/actions/calendar-event";

/**
 * The closed set of types a standing rule may cover. RAIL 1.
 *
 * The test is not "is this convenient" but "if Loki got it wrong while I was
 * asleep, what did it cost me?" — and the only acceptable answer is "a row I
 * delete". Everything absent from this set reaches other people, spends money,
 * or runs code, and stays a per-item decision forever:
 *   send_message / send_email — outward, unrecallable
 *   dispatch_prompt          — runs an agent against a repo
 *   import/enrich/merge_person — mutates the people book from parsed input
 *   follow_up / other        — unbounded by construction
 */
export const STANDING_APPROVAL_ELIGIBLE: readonly ActionType[] = [
  ACTION_TYPE.CREATE_EVENT,
  ACTION_TYPE.CREATE_COMMITMENT,
] as const;

const ELIGIBLE = new Set<ActionType>(STANDING_APPROVAL_ELIGIBLE);

export function isStandingApprovalEligible(type: ActionType): boolean {
  return ELIGIBLE.has(type);
}

/**
 * Keep only the eligible types out of whatever is stored. Applied on READ, not
 * only on write: a preference row predating a shrink of the eligible set, or
 * written by a path that skipped validation, must not be able to authorise
 * anything. RAIL 1, enforced at the point of use.
 */
export function sanitizeStandingApprovals(
  stored: readonly string[] | null | undefined,
): ActionType[] {
  if (!stored?.length) return [];
  const seen = new Set<ActionType>();
  for (const raw of stored) {
    const t = String(raw).trim() as ActionType;
    if (ELIGIBLE.has(t)) seen.add(t);
  }
  return STANDING_APPROVAL_ELIGIBLE.filter((t) => seen.has(t));
}

/**
 * What the operator is actually agreeing to, per type — the settings copy.
 *
 * It lives beside the rule instead of in the component so the two cannot drift:
 * a type added to the eligible set with no honest description of its blast
 * radius would be a switch offering power it does not explain, and the reason
 * this set is safe is precisely that each entry's worst case is stated and
 * small. `detail` says what happens when it fires AND what still stops it.
 */
export const STANDING_APPROVAL_OPTIONS: ReadonlyArray<{
  type: ActionType;
  label: string;
  detail: string;
}> = [
  {
    type: ACTION_TYPE.CREATE_EVENT,
    label: "Put appointments in my calendar",
    detail:
      "Booked as you ask for them, with a message here once it's really in. Events with guests still wait for your yes — those send invitations.",
  },
  {
    type: ACTION_TYPE.CREATE_COMMITMENT,
    label: "Record commitments I mention",
    detail: "Written to your own commitments list. Nothing leaves Loki.",
  },
] as const;

export type StandingVerdict =
  | { auto: true }
  /** `reason` is operator-facing: it is shown on the queued card so a fall-back
   *  to the queue never looks like the rule silently failing to work. */
  | { auto: false; reason: string };

const NO_RULE: StandingVerdict = { auto: false, reason: "no standing approval for this type" };

/**
 * Does a standing rule authorise THIS action, with THIS payload, right now?
 *
 * Pure — no I/O, no clock of its own — so every rail above can be asserted
 * directly (scripts/test/standing-approval.ts) instead of trusted. The one
 * thing it must never do is return `{auto:true}` for something it has not
 * positively established is private, reversible and complete.
 */
export function standingApprovalVerdict(input: {
  type: ActionType;
  payload: ActionPayload | null | undefined;
  standingApprovals: readonly string[] | null | undefined;
  now?: number;
}): StandingVerdict {
  const { type, payload } = input;
  const now = input.now ?? Date.now();

  if (!ELIGIBLE.has(type)) return NO_RULE;
  if (!sanitizeStandingApprovals(input.standingApprovals).includes(type)) return NO_RULE;

  if (type === ACTION_TYPE.CREATE_EVENT) {
    // RAIL 2 — attendees turn a private note-to-self into outbound mail.
    if (hasAttendees(payload)) {
      return {
        auto: false,
        reason: "event has guests — invitations go out, so this needs your yes",
      };
    }
    // RAIL 3 — no usable time means the booking would be wrong or would fail
    // on the drain forever. A human can supply the date; a rule cannot.
    if (!resolveEventTimes(payload)) {
      return { auto: false, reason: "no date/time I could resolve — confirm when this is" };
    }
    if (isEventSlotPassed(payload, now)) {
      return { auto: false, reason: "that slot is already in the past" };
    }
  }

  return { auto: true };
}

/**
 * Attendee detection across the shapes Loki actually produces. Deliberately
 * generous: a string, an array, or a comma list all count, and anything
 * non-empty in an attendee-ish field is treated as "there are guests". A false
 * positive costs one tap; a false negative mails strangers.
 */
function hasAttendees(payload: ActionPayload | null | undefined): boolean {
  if (!payload) return false;
  for (const key of ["attendees", "guests", "invitees", "eventAttendees"] as const) {
    const value = (payload as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      if (value.some((v) => String(v ?? "").trim())) return true;
    } else if (typeof value === "string" && value.trim()) {
      return true;
    }
  }
  return false;
}
