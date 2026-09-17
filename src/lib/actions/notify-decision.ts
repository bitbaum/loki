/**
 * The approval queue, delivered to the chat the request was made in.
 *
 * WHAT THIS REPLACES
 * The queue announced itself once an hour with a count and a bare URL:
 * "2 actions are waiting for your approval. Approve or reject: <app>/approvals".
 * That message states a problem and hands back a chore. Everything needed to
 * answer — what it is, when it is, whether it is right — was left on the other
 * side of a login.
 *
 * So the message becomes the surface. A card carries the decision itself, and
 * the buttons ARE the decision (lib/actions/action-link.ts). Nothing is sent
 * that cannot be acted on from where it lands.
 *
 * TWO MESSAGES, AND ONLY TWO — because the fleet has already learned what
 * happens otherwise (2026-08-05: 40 disk alerts in three hours taught the
 * operator to ignore the channel):
 *
 *   1. A DECISION IS OWED  → sent once, when a draft is queued from something
 *      the operator actually asked for. Never for Loki's own spontaneous
 *      proposals (check-ins, the advisor) — those stay in the hourly digest,
 *      where an unread one costs nothing.
 *   2. THE EFFECT HAPPENED → sent once, when the row really reaches 'executed'.
 *      Not on approval: approving a calendar event only hands it to the drain,
 *      and "approved" was never the thing the operator wanted to hear.
 *
 * The storm rule was never "send less". It was "never send something the
 * reader cannot act on". A card with buttons is the work, not a nag about it.
 */
import type { ActionRow } from "@/db/queries/actions";
import { ACTION_TYPE } from "@/lib/constants/statuses";
import { actionEditUrl, actionLinkUrl } from "@/lib/actions/action-link";
import {
  sendTelegramMessage,
  selfTelegramTarget,
  type TelegramKeyboard,
  type SendResult,
} from "@/lib/actions/telegram-send";
import { resolveEventTimes } from "@/lib/actions/calendar-event";
import { getUserPreferences, getActiveTimezone } from "@/db/queries/user-preferences";
import { logDebug } from "@/db/queries/debug-logs";
import { APP_URL } from "@/config/brand";

/** Where a standing approval is switched off. */
const APPROVALS_URL = `${APP_URL}/approvals`;

/** Human label per type, for the card's first line. */
const TYPE_LABEL: Record<string, string> = {
  [ACTION_TYPE.CREATE_EVENT]: "Calendar event",
  [ACTION_TYPE.CREATE_COMMITMENT]: "Commitment",
  [ACTION_TYPE.SEND_MESSAGE]: "Message",
  [ACTION_TYPE.SEND_EMAIL]: "Email",
  [ACTION_TYPE.DISPATCH_PROMPT]: "Dispatch",
  [ACTION_TYPE.FOLLOW_UP]: "Follow-up",
};

/**
 * "Fri 19 Sep, 14:00–15:00" / "Fri 19 Sep (all day)" in the operator's own
 * timezone.
 *
 * The timezone is not cosmetic here. The payload holds instants, and the whole
 * point of the message is to let someone confirm a time at a glance — rendered
 * in UTC, a 14:00 Zurich appointment reads as 12:00 and looks wrong, so the
 * operator opens the app to check, which is the trip this exists to save.
 */
export function describeEventWhen(payload: ActionRow["payload"], timeZone: string): string | null {
  const times = resolveEventTimes(payload);
  if (!times) return null;

  if (times.allDay) {
    const day = new Date(`${times.from}T12:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    return `${day} (all day)`;
  }

  const from = new Date(times.from);
  const to = new Date(times.to);
  const day = from.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  });
  const hm = (d: Date) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  return `${day}, ${hm(from)}–${hm(to)}`;
}

/** The body lines that describe WHAT is being decided, per type. */
function describeAction(action: ActionRow, timeZone: string): string[] {
  const lines: string[] = [];
  const p = action.payload ?? {};

  if (action.type === ACTION_TYPE.CREATE_EVENT) {
    const when = describeEventWhen(action.payload, timeZone);
    if (when) lines.push(`🕑 ${when}`);
    if (typeof p.eventLocation === "string" && p.eventLocation.trim()) {
      lines.push(`📍 ${p.eventLocation.trim()}`);
    }
  }
  if (typeof p.to === "string" && p.to.trim()) lines.push(`→ ${p.to.trim()}`);
  if (typeof p.dueDate === "string" && p.dueDate.trim()) lines.push(`📅 due ${p.dueDate.trim()}`);
  if (typeof p.body === "string" && p.body.trim()) {
    const body = p.body.trim();
    lines.push(`\n${body.length > 600 ? `${body.slice(0, 600)}…` : body}`);
  }
  return lines;
}

/**
 * A draft is waiting on a human. Card + [Approve] [Edit] [Reject].
 *
 * `reason` is the standing-approval verdict's explanation when there was one —
 * "event has guests", "no date/time I could resolve". Saying WHY this one still
 * needs a tap is what stops a standing rule from looking broken the first time
 * it correctly declines to fire.
 *
 * Best-effort by contract: a Telegram outage must never fail the enqueue that
 * called it. The draft is safe in the database either way; the message is the
 * convenience.
 */
export async function notifyActionNeedsDecision(
  userId: string,
  action: ActionRow,
  reason?: string,
): Promise<void> {
  const target = selfTelegramTarget();
  if (!target) return;

  try {
    const tz = getActiveTimezone(await getUserPreferences(userId).catch(() => null));
    const label = TYPE_LABEL[action.type] ?? "Action";
    const lines = [
      `📋 ${label} — needs your yes`,
      `“${action.title}”`,
      ...describeAction(action, tz),
    ];
    if (reason) lines.push(`\nWhy you're being asked: ${reason}.`);

    const keyboard: TelegramKeyboard = [
      [
        {
          text: "✅ Approve",
          url: actionLinkUrl({ actionId: action.id, userId, verb: "approve" }),
        },
        { text: "✕ Reject", url: actionLinkUrl({ actionId: action.id, userId, verb: "reject" }) },
      ],
      [{ text: "✏️ Edit", url: actionEditUrl(action.id) }],
    ];

    await reportSend(
      await sendTelegramMessage(target, lines.join("\n"), { buttons: keyboard }),
      action.id,
      "approval card",
    );
  } catch (err) {
    await logFailure(action.id, "approval card", err instanceof Error ? err.message : String(err));
  }
}

/**
 * The effect actually happened. Sent from the two places a CREATE_EVENT row
 * really reaches 'executed' (the in-process executor and the box drain), so it
 * reports a booking rather than a decision.
 *
 * `autoApproved` changes the wording, not the fact: when a standing rule acted
 * in the operator's name, the message must say so plainly — an action taken on
 * your behalf that reads as one you took yourself is how standing rules stop
 * being reviewable.
 */
export async function notifyActionExecuted(
  userId: string,
  action: ActionRow,
  opts: { htmlLink?: string | null; autoApproved?: boolean } = {},
): Promise<void> {
  const target = selfTelegramTarget();
  if (!target) return;

  try {
    const tz = getActiveTimezone(await getUserPreferences(userId).catch(() => null));
    const isEvent = action.type === ACTION_TYPE.CREATE_EVENT;
    const head = isEvent ? "📅 Booked" : "✅ Done";
    const lines = [`${head} — “${action.title}”`, ...describeAction(action, tz)];
    if (opts.autoApproved) {
      // Name the rule AND where to switch it off, in the same breath. A
      // standing approval the operator cannot find is one they cannot
      // withdraw, and an unwithdrawable permission is not a permission.
      lines.push(
        `\nDone without asking — you have a standing approval for ${
          TYPE_LABEL[action.type]?.toLowerCase() ?? action.type
        }s. Turn it off at ${APPROVALS_URL}.`,
      );
    }

    // "Open in Google Calendar" is the undo, and it is a better one than a
    // button here would be: the event is already in the place the operator
    // edits and deletes events, with every field editable. A bespoke undo link
    // would only be able to offer the all-or-nothing half of that.
    const keyboard: TelegramKeyboard = opts.htmlLink
      ? [[{ text: "📅 Open in calendar", url: opts.htmlLink }]]
      : [];

    await reportSend(
      await sendTelegramMessage(target, lines.join("\n"), { buttons: keyboard }),
      action.id,
      "execution confirmation",
    );
  } catch (err) {
    await logFailure(
      action.id,
      "execution confirmation",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * A refused send is a failure, even though nothing threw.
 *
 * sendTelegramMessage reports a rejected token, a blocked chat or an API error
 * as `{ok:false}` — an ordinary return value. Only catching exceptions
 * therefore left the one case that actually happens in production completely
 * silent, and silence here is the expensive kind: the confirmation message IS
 * the review mechanism for actions a standing rule took without asking. If it
 * stops arriving, the operator does not notice that Loki went quiet — they
 * notice that Loki apparently stopped doing things, which is the opposite of
 * what is true.
 */
async function reportSend(result: SendResult, actionId: string, what: string): Promise<void> {
  if (result.ok) return;
  await logFailure(actionId, what, result.error ?? "telegram refused the send");
}

async function logFailure(actionId: string, what: string, error: string): Promise<void> {
  await logDebug({
    source: "actions/notify-decision",
    level: "warn",
    message: `could not send ${what}`,
    meta: { actionId, error },
  }).catch(() => {});
}
