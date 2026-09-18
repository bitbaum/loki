// Cron target — the weekly "what's on" digest.
//
// WHY THIS EXISTS
// The operator asked to be told about events worth going to instead of finding
// them by accident after they had happened. The hard part is not finding
// events; it is sending a message that stays worth opening in week six.
//
// So the shape is borrowed wholesale from what already works here:
//
//   ONE MESSAGE, NOT ONE PER EVENT. The 2026-08-05 disk-alert storm (40 pings
//   in three hours) is the standing lesson about per-item notification.
//
//   EVERY LINE IS ACTIONABLE. Each event is a real draft in the approval queue
//   with its own one-tap Approve link, so "that looks good" is a tap and the
//   event is in the calendar — not a link to a listings page and a note to self.
//
//   NOTHING IS A RESULT, AND SO IS NOT LOOKING. A quiet week sends nothing at
//   all. A week where no search backend answered sends nothing either, but says
//   so in the log rather than implying Zurich was empty — the distinction
//   ai-kit/web exists to preserve, and the reason an expired key can hide for a
//   month behind a plausible silence.
//
// Schedule: weekly (systemd timer). Cadence chosen by the operator 2026-09-17:
// a weekly plan for the week ahead, plus a same-day nudge for what they said
// yes to (that half is the existing calendar, which already reminds them).

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import { scoutEvents, dedupeKey } from "@/lib/events/scout";
import { proposeAction, getRecentActions, getPendingActions } from "@/db/queries/actions";
import { recordActionAuditEvent } from "@/db/queries/control-audit-events";
import { getBusyAround } from "@/db/queries/calendar-busy";
import { conflictsFor, conflictLine } from "@/lib/calendar/busy";
import { getUserPreferences, getActiveTimezone } from "@/db/queries/user-preferences";
import { sendTelegramMessage, selfTelegramTarget } from "@/lib/actions/telegram-send";
import { actionLinkUrl } from "@/lib/actions/action-link";
import { ACTION_TYPE } from "@/lib/constants/statuses";
import { getFleetAutopilotUserIds } from "@/db/queries/beacon-settings";

/** Title prefix, so a scouted draft is recognisable in the queue and in history. */
export const SCOUT_TITLE_PREFIX = "Event: ";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const now = new Date();

  // Same population as the other proposal producers (propose-checkins), rather
  // than a hardcoded operator: one list of "users the fleet acts for", so a
  // second definition cannot drift from the first. The Telegram half is
  // self-only regardless (telegram-send refuses every other recipient), so a
  // second user would queue drafts and send nothing — which is why the digest
  // send is attempted once, for the user whose chat is configured.
  const users = await getFleetAutopilotUserIds();
  const userId = users[0];
  if (!userId) {
    await logDebug({
      source: "crons/scout-events",
      level: "info",
      message: "no fleet-autopilot user — nothing to scout for",
    });
    return NextResponse.json({ ok: true, status: "no-user", sent: false });
  }

  // What we already offered, and what was turned down. Both mean "do not send
  // this again" — the rejection half IS the learning loop: the operator says no
  // once and the queue remembers, instead of a taste profile they have to keep.
  const [pending, recent] = await Promise.all([
    getPendingActions(userId).catch(() => []),
    getRecentActions(userId, 200).catch(() => []),
  ]);
  const seenKeys = new Set(
    [...pending, ...recent]
      .filter((a) => a.title.startsWith(SCOUT_TITLE_PREFIX))
      .map((a) => dedupeKey({ title: a.title.slice(SCOUT_TITLE_PREFIX.length) })),
  );

  const outcome = await scoutEvents({ seenKeys, now });

  if (outcome.status === "could_not_look") {
    // Loud in the log, silent on the phone. Nobody can act on "search is down"
    // at 08:00 on a Friday, but a month of empty digests with no explanation is
    // how a dead backend goes unnoticed.
    await logDebug({
      source: "crons/scout-events",
      level: "warn",
      message: `no search backend answered — digest skipped, NOT "nothing on"`,
      meta: { detail: outcome.detail },
    });
    return NextResponse.json({ ok: true, status: outcome.status, sent: false });
  }

  if (outcome.status === "nothing") {
    await logDebug({
      source: "crons/scout-events",
      level: "info",
      message: `searched ${outcome.searched} topic(s), nothing worth proposing`,
    });
    return NextResponse.json({ ok: true, status: outcome.status, sent: false });
  }

  const tz = getActiveTimezone(await getUserPreferences(userId).catch(() => null));
  const fmtDay = (d: Date, allDay: boolean) =>
    allDay
      ? d.toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        })
      : `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz })}`;

  const lines: string[] = [`🗓 Worth your week — ${outcome.events.length} found`];
  const buttons: Array<Array<{ text: string; url: string }>> = [];
  let queued = 0;

  for (const ev of outcome.events) {
    // A draft per event, so each gets a real id to sign a one-tap link against.
    // operatorRequested:false — these are Loki's idea, so they must NOT each
    // fire their own approval card; this digest is their single announcement.
    const created = await proposeAction(userId, {
      type: ACTION_TYPE.CREATE_EVENT,
      title: `${SCOUT_TITLE_PREFIX}${ev.title}`.slice(0, 160),
      reasoning: ev.rationale,
      payload: {
        eventTitle: ev.title,
        eventStart: ev.allDay ? undefined : ev.start.toISOString(),
        eventEnd: ev.allDay ? undefined : ev.end.toISOString(),
        eventDate: ev.allDay ? ev.start.toISOString().slice(0, 10) : undefined,
        allDay: ev.allDay || undefined,
        eventLocation: ev.location,
        url: ev.url,
        scoutCategory: ev.category,
      },
    }).catch(() => null);
    if (!created) continue; // deduped against an identical pending title
    await recordActionAuditEvent(userId, created, "proposed", { meta: { via: "event-scout" } });
    queued++;

    // Clash check against the mirror, so a suggestion never quietly collides
    // with something already booked. Same three-valued answer as the approval
    // card: a stale mirror says so rather than implying a free evening.
    let clash = "";
    try {
      const { blocks, syncedAt } = await getBusyAround(userId, ev.start, ev.end);
      const verdict = conflictsFor({ start: ev.start, end: ev.end, busy: blocks, syncedAt, now });
      // Only the genuine collision is worth a line here; "couldn't check" on
      // six suggestions at once would be six copies of the same caveat.
      if (verdict.state === "conflict") {
        clash =
          " " +
          (conflictLine(verdict, (d) =>
            d.toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: tz,
            }),
          ) ?? "");
      }
    } catch {
      /* the suggestion is still worth sending without a clash check */
    }

    lines.push(
      `\n• ${ev.title}\n  ${fmtDay(ev.start, ev.allDay)}${ev.location ? ` · ${ev.location}` : ""}` +
        `\n  ${ev.rationale}${clash}`,
    );
    buttons.push([
      {
        text: `✅ ${ev.title}`.slice(0, 60),
        url: actionLinkUrl({ actionId: created.id, userId, verb: "approve" }),
      },
    ]);
  }

  if (queued === 0) {
    await logDebug({
      source: "crons/scout-events",
      level: "info",
      message: "every suggestion deduped against an existing draft — nothing sent",
    });
    return NextResponse.json({ ok: true, status: "deduped", sent: false });
  }

  lines.push(`\nTap one to put it in your calendar. Ignore the rest — they expire on their own.`);

  const tg = selfTelegramTarget();
  const sent = tg ? await sendTelegramMessage(tg, lines.join("\n"), { buttons }) : { ok: false };

  await logDebug({
    source: "crons/scout-events",
    level: sent.ok ? "info" : "warn",
    message: sent.ok
      ? `sent ${queued} suggestion(s) from ${outcome.searched} topic(s)`
      : `queued ${queued} suggestion(s) but the digest did not send`,
    meta: { queued, searched: outcome.searched, extracted: outcome.extracted },
  });

  return NextResponse.json({ ok: true, status: "suggestions", queued, sent: sent.ok });
}
