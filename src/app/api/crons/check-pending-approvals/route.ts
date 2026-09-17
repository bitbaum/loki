// Cron target — the approval queue announces itself.
//
// WHY THIS EXISTS
// A draft action is Loki asking a question. Until it is answered nothing
// happens — no event booked, no message sent — and yet nothing anywhere told
// the operator a question was waiting. The queue was discoverable only by
// opening /approvals and looking.
//
// Observed 2026-08-04: "Create Calendar Event: Appointment with Simon" was
// proposed at 14:15 and approved at 21:02 — 6h47m later, and only because the
// operator went asking why the appointment hadn't appeared. The event booked
// fine four seconds after approval. Nothing was broken; the request was simply
// invisible for seven hours.
//
// The queue had also become a landfill: on 2026-08-06 it held 15 drafts, the
// oldest 121 days old, four of them calendar events whose dates had already
// passed — approving those would have booked events in the past. A queue that
// offers dead choices teaches you not to open it.
//
// So this closes the loop the same way check-runner-stall does:
//   0. EXPIRE  — retire drafts that can no longer be decided (aged out, or an
//                event slot that has passed), so the rest is a live decision list.
//   1. RAISE   — one in-app alert per episode, refreshed as the count changes.
//   2. PING    — one Telegram message when the flag GOES UP (never per tick).
//   3. RESOLVE — clear the alert once the backlog is handled, so the flag can
//                rise again next time. An alert that cannot fall works once.
//
// Deliberately NOT per-draft: a message for every proposal is how you train
// someone to ignore the channel (see the 2026-08-05 disk alert storm — 40
// notifications in three hours taught exactly that lesson).
//
// Schedule: hourly (systemd timer, scripts/install-hetzner-crons.sh).

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import {
  getStaleDraftSummaries,
  expireDeadDrafts,
  getDraftsByType,
  expireDraft,
} from "@/db/queries/actions";
import {
  refreshOrInsertActiveAlert,
  dismissActiveAlertsByType,
  getUserIdsWithActiveAlertType,
} from "@/db/queries/alerts";
import { recordActionAuditEvent } from "@/db/queries/control-audit-events";
import { isEventSlotPassed, resolveEventTimes } from "@/lib/actions/calendar-event";
import { sendTelegramMessage, selfTelegramTarget } from "@/lib/actions/telegram-send";
import { ACTION_TYPE } from "@/lib/constants/statuses";
import { APP_URL } from "@/config/brand";
import { actionEditUrl, actionLinkUrl } from "@/lib/actions/action-link";

/** Alert type — the dedupe key for raise/refresh/resolve. */
const ALERT_TYPE = "pending_approvals";

/**
 * How long an unanswered draft stays a live question. Past this it is retired:
 * a nudge nobody acted on in a month is not a decision still owed, and a queue
 * that never forgets stops being read at all.
 */
const DRAFT_MAX_AGE_DAYS = 30;

/**
 * How long a draft may wait before it counts as forgotten rather than fresh.
 * An hour: long enough that someone who queued it from the chat UI (where it is
 * visible immediately) is never nagged about their own in-flight request, short
 * enough that a same-day appointment is still bookable.
 */
const REMINDER_AFTER_MINUTES = 60;

function waitedLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  // 0. Retire dead drafts FIRST, so the alert below counts live decisions only.
  //    Nagging about a proposal nobody can act on is how an alert channel dies.
  const expired = await expireDeadDrafts(DRAFT_MAX_AGE_DAYS);
  for (const row of expired) {
    await recordActionAuditEvent(row.userId, row, "expired", {
      reason: `no decision within ${DRAFT_MAX_AGE_DAYS} days`,
    });
  }

  // A calendar event whose slot has already passed is dead on arrival —
  // approving it would book something in the past. Only SQL-invisible rule
  // here: the date lives in JSONB. Payloads with no resolvable time are left
  // alone (unknown ≠ expired); the age cap above catches them eventually.
  let expiredPastDated = 0;
  const now = Date.now();
  for (const row of await getDraftsByType(ACTION_TYPE.CREATE_EVENT)) {
    if (!isEventSlotPassed(row.payload, now)) continue;
    const closed = await expireDraft(row.id);
    if (!closed) continue;
    expiredPastDated++;
    await recordActionAuditEvent(row.userId, closed, "expired", {
      reason: `event slot already passed (${resolveEventTimes(row.payload)?.to ?? "unknown end"})`,
    });
  }

  const stale = await getStaleDraftSummaries(REMINDER_AFTER_MINUTES);
  const staleUserIds = new Set(stale.map((s) => s.userId));

  let raised = 0;
  let pinged = 0;

  for (const s of stale) {
    const waited = waitedLabel(s.oldestAgeSeconds);
    const noun = s.pending === 1 ? "action is" : "actions are";
    const { created } = await refreshOrInsertActiveAlert({
      userId: s.userId,
      type: ALERT_TYPE,
      severity: "warning",
      title: `${s.pending} ${noun} waiting for your approval`,
      description: `Oldest: "${s.oldestTitle}" — waiting ${waited}. Nothing in the queue runs until you approve it.`,
      actionUrl: "/approvals",
      metadata: {
        pending: s.pending,
        oldestTitle: s.oldestTitle,
        oldestAgeSeconds: s.oldestAgeSeconds,
      },
    });

    if (created) {
      raised++;
      // Out-of-band ping only when the flag goes up. The operator is usually
      // not looking at the app — that is the entire failure this fixes.
      const tg = selfTelegramTarget();
      if (tg) {
        // The digest stays a digest (one message per episode, never per draft),
        // but it no longer ends in a chore. When the backlog is a SINGLE item,
        // the decision itself rides along as buttons — the common case by far,
        // and the one where "go to the website and find the row" was absurd.
        // Several items have no single answer, so that one still routes to the
        // queue, which is the right place to triage more than one decision.
        const buttons =
          s.pending === 1
            ? [
                [
                  {
                    text: "✅ Approve",
                    url: actionLinkUrl({
                      actionId: s.oldestId,
                      userId: s.userId,
                      verb: "approve",
                    }),
                  },
                  {
                    text: "✕ Reject",
                    url: actionLinkUrl({ actionId: s.oldestId, userId: s.userId, verb: "reject" }),
                  },
                ],
                [{ text: "✏️ Edit", url: actionEditUrl(s.oldestId) }],
              ]
            : [[{ text: `📋 Review ${s.pending} items`, url: `${APP_URL}/approvals` }]];

        const sent = await sendTelegramMessage(
          tg,
          `🕐 Loki: ${s.pending} ${noun} waiting for your approval.\n` +
            `Oldest: "${s.oldestTitle}" (${waited}).\n` +
            `Nothing runs until you decide.`,
          { buttons },
        );
        if (sent.ok) pinged++;
      }
    }
  }

  // Resolve: a user who was flagged and no longer has a stale backlog is done —
  // clear the alert so the next backlog can raise a fresh one.
  let cleared = 0;
  for (const userId of await getUserIdsWithActiveAlertType(ALERT_TYPE)) {
    if (staleUserIds.has(userId)) continue;
    cleared += await dismissActiveAlertsByType(userId, ALERT_TYPE);
  }

  const expiredTotal = expired.length + expiredPastDated;
  // Warn when this RUN did something; info when it merely observed a state.
  //
  // This used to warn whenever a stale user existed, which is a fact about the
  // world rather than about the run — and the world does not change hourly. It
  // produced 168 identical warnings in seven days, every one of them with
  // expired/raised/pinged/cleared all zero, on a surface carrying six real
  // errors. The state itself is not lost: a stale approval already has an open
  // `pending_approvals` alert, which is the thing designed to represent an
  // ongoing condition once rather than sixty-eight times.
  //
  // The alert records what is true; the log records what happened.
  const didSomething = expiredTotal > 0 || raised > 0 || pinged > 0 || cleared > 0;
  await logDebug({
    source: "crons/check-pending-approvals",
    level: didSomething ? "warn" : "info",
    message:
      `expired ${expiredTotal} dead draft(s) (${expired.length} aged out, ${expiredPastDated} past-dated); ` +
      `${stale.length} user(s) still waiting >${REMINDER_AFTER_MINUTES}m: ${raised} raised, ${pinged} pinged, ${cleared} cleared`,
    meta: {
      expiredAged: expired.length,
      expiredPastDated,
      staleUsers: stale.length,
      raised,
      pinged,
      cleared,
      thresholdMinutes: REMINDER_AFTER_MINUTES,
      maxAgeDays: DRAFT_MAX_AGE_DAYS,
    },
  });

  return NextResponse.json({
    ok: true,
    expired: { agedOut: expired.length, pastDated: expiredPastDated },
    staleUsers: stale.length,
    raised,
    pinged,
    cleared,
  });
}
