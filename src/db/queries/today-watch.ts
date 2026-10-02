import { and, eq, lte, isNotNull, asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { goals, events, commitments, subscriptions } from "@/db/schema";
import {
  GOAL_STATUS,
  COMMITMENT_STATUS,
  EVENT_STATUS,
  ENTITY_TYPE,
} from "@/lib/constants/statuses";
import { HEALTH_FADING_DAYS } from "@/lib/constants/people";
import { DAY_MS } from "@/lib/constants/time";
import { getTodayHabits } from "@/db/queries/habits";
import { chargesDueBy } from "@/lib/subscription-due";
import { SUB_STATUS } from "@/lib/constants/statuses";

// A streak this long carries real psychological momentum — surfacing the
// possibility of breaking it is the kind of nudge the Watch exists for.
const HABIT_STREAK_THRESHOLD = 7;

const STALLED_DAYS = 21;
const IMMINENT_DAYS = 5;

export type WatchFocus = {
  kind:
    | "overdue-commitment"
    | "overdue-goal"
    | "habit-at-risk"
    | "imminent-bill"
    | "imminent-event"
    | "stale-contact"
    | "stalled-goal";
  title: string;
  context: string; // a single short clarifying line ("85% done · 1mo past target")
  href: string; // where the user goes if they click through
  lokiPrompt: string; // pre-built prompt body for "Brief Loki on this"
};

export type WatchData = {
  focus: WatchFocus | null;
  /** Counts across categories so the Watch can show a one-line totals strip. */
  totals: {
    overdueCommitments: number;
    overdueGoals: number;
    imminentBills: number;
    imminentEvents: number;
    staleContacts: number;
    habitsAtRisk: number;
    stalledGoals: number;
  };
};

/**
 * Pick the one thing the user should care about right now and bundle it with
 * a totals strip across the rest of the private-zone signals.
 *
 * Priority order (highest first):
 *   1. Overdue commitments — something the user explicitly promised, now late.
 *   2. Overdue goals with high progress — close to done but past target.
 *   3. Imminent renewals — money about to leave the account in <5 days.
 *   4. Imminent events — deadlines (not financial) in <5 days.
 *   5. Stalled goals — active goals with no movement in 21+ days.
 *
 * Returns null focus when none of the above categories has an item — Today
 * gets a quieter "all clear" rendering in that case.
 */
export async function getTodayWatch(userId: string): Promise<WatchData> {
  const now = new Date();
  const imminentBy = new Date(now.getTime() + IMMINENT_DAYS * DAY_MS);
  const stalledBy = new Date(now.getTime() - STALLED_DAYS * DAY_MS);

  const [
    overdueCommitmentRows,
    overdueGoalRows,
    billRows,
    imminentEventRows,
    staleContactRows,
    stalledGoalRows,
    todayHabits,
  ] = await Promise.all([
    db
      .select({
        id: commitments.id,
        description: commitments.description,
        dueDate: commitments.dueDate,
      })
      .from(commitments)
      .where(
        and(
          eq(commitments.userId, userId),
          eq(commitments.status, COMMITMENT_STATUS.ACTIVE),
          isNotNull(commitments.dueDate),
          lte(commitments.dueDate, now),
        ),
      )
      .orderBy(asc(commitments.dueDate)),

    db
      .select({
        id: goals.id,
        title: goals.title,
        progress: goals.progress,
        targetDate: goals.targetDate,
      })
      .from(goals)
      .where(
        and(
          eq(goals.userId, userId),
          eq(goals.status, GOAL_STATUS.ACTIVE),
          isNotNull(goals.targetDate),
          lte(goals.targetDate, now),
        ),
      )
      .orderBy(desc(goals.progress)),

    db
      .select({
        id: subscriptions.id,
        name: subscriptions.name,
        amount: subscriptions.amount,
        currency: subscriptions.currency,
        nextDue: subscriptions.nextDue,
        frequency: subscriptions.frequency,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, SUB_STATUS.ACTIVE),
          isNotNull(subscriptions.nextDue),
        ),
      ),

    db
      .select({ id: events.id, name: events.name, deadline: events.deadline })
      .from(events)
      .where(
        and(
          eq(events.userId, userId),
          eq(events.status, EVENT_STATUS.ACTIVE),
          isNotNull(events.deadline),
          lte(events.deadline, imminentBy),
        ),
      )
      .orderBy(asc(events.deadline)),

    // Stale contacts — entities of type=person whose latest interaction is
    // older than the fading threshold. Bound to a single COUNT-and-TOP since
    // the Watch only needs the most-stale one to focus on.
    db.execute<{ id: string; name: string; last_interaction: string | null }>(sql`
      SELECT e.id, e.name, max(i.occurred_at)::text AS last_interaction
      FROM entities e
      JOIN interactions i ON i.entity_id = e.id AND i.user_id = ${userId}
      WHERE e.user_id = ${userId}
        AND e.type = ${ENTITY_TYPE.PERSON}
      GROUP BY e.id, e.name
      HAVING max(i.occurred_at) < now() - make_interval(days => ${HEALTH_FADING_DAYS})
      ORDER BY max(i.occurred_at) ASC
      LIMIT 25
    `),

    db
      .select({
        id: goals.id,
        title: goals.title,
        progress: goals.progress,
        updatedAt: goals.updatedAt,
      })
      .from(goals)
      .where(
        and(
          eq(goals.userId, userId),
          eq(goals.status, GOAL_STATUS.ACTIVE),
          lte(goals.updatedAt, stalledBy),
        ),
      )
      .orderBy(asc(goals.updatedAt)),

    // Habit streaks at risk — habits due today, not yet done, with a streak
    // long enough to be psychologically meaningful. getTodayHabits already
    // computes the streak from completion history, so reuse it instead of
    // duplicating the streak math.
    getTodayHabits(userId),
  ]);

  const staleContactList = Array.from(staleContactRows) as Array<{
    id: string;
    name: string;
    last_interaction: string | null;
  }>;
  // Imminent means the NEXT charge lands within the window — not that a stored
  // date has passed (a renewed subscription is not a bill due today).
  const imminentBillRows = chargesDueBy(billRows, imminentBy, now).map((b) => ({
    id: b.id,
    name: b.name,
    amount: b.amount,
    currency: b.currency,
    nextBilling: b.nextCharge,
  }));
  const habitsAtRisk = todayHabits
    .filter((h) => !h.doneToday && h.streak >= HABIT_STREAK_THRESHOLD)
    .sort((a, b) => b.streak - a.streak);

  const totals = {
    overdueCommitments: overdueCommitmentRows.length,
    overdueGoals: overdueGoalRows.length,
    imminentBills: imminentBillRows.length,
    imminentEvents: imminentEventRows.length,
    staleContacts: staleContactList.length,
    habitsAtRisk: habitsAtRisk.length,
    stalledGoals: stalledGoalRows.length,
  };

  // Pick the highest-priority focus item.
  const focus = pickFocus(
    overdueCommitmentRows,
    overdueGoalRows,
    habitsAtRisk,
    imminentBillRows,
    imminentEventRows,
    staleContactList,
    stalledGoalRows,
    now,
  );

  return { focus, totals };
}

function pickFocus(
  overdueCommitments: { id: string; description: string; dueDate: Date | null }[],
  overdueGoals: { id: string; title: string; progress: number | null; targetDate: Date | null }[],
  habitsAtRisk: { id: string; title: string; streak: number }[],
  imminentBills: {
    id: string;
    name: string;
    amount: number | null;
    currency: string | null;
    nextBilling: Date | null;
  }[],
  imminentEvents: { id: string; name: string; deadline: Date | null }[],
  staleContacts: { id: string; name: string; last_interaction: string | null }[],
  stalledGoals: { id: string; title: string; progress: number | null; updatedAt: Date }[],
  now: Date,
): WatchFocus | null {
  const c = overdueCommitments[0];
  if (c) {
    const daysOverdue = c.dueDate
      ? Math.floor((now.getTime() - new Date(c.dueDate).getTime()) / DAY_MS)
      : null;
    return {
      kind: "overdue-commitment",
      title: c.description,
      context: daysOverdue !== null ? `Overdue by ${daysOverdue}d` : "Overdue",
      href: "/today#commitments",
      lokiPrompt: `An overdue commitment needs attention:\n\n"${c.description}"\n${daysOverdue !== null ? `It's ${daysOverdue} days past the due date.\n` : ""}\nWhat's the cleanest path to close this out today?`,
    };
  }

  const g = overdueGoals[0];
  if (g) {
    const daysOverdue = g.targetDate
      ? Math.floor((now.getTime() - new Date(g.targetDate).getTime()) / DAY_MS)
      : null;
    const progress = g.progress ?? 0;
    return {
      kind: "overdue-goal",
      title: g.title,
      context: `${progress}% done · ${daysOverdue !== null ? `${daysOverdue}d past target` : "past target"}`,
      href: "/goals",
      lokiPrompt: `An overdue goal is close to done:\n\nGoal: ${g.title}\nProgress: ${progress}%\n${daysOverdue !== null ? `Days past target: ${daysOverdue}\n` : ""}\nWhat's the smallest concrete step today to close it out?`,
    };
  }

  const h = habitsAtRisk[0];
  if (h) {
    return {
      kind: "habit-at-risk",
      title: h.title,
      context: `${h.streak}-day streak · not done today`,
      href: "/habits",
      lokiPrompt: `A habit streak is at risk:\n\nHabit: ${h.title}\nCurrent streak: ${h.streak} day${h.streak === 1 ? "" : "s"}\nStatus today: not yet done\n\nNudge me to do it now in two short lines — be direct and warm, not preachy.`,
    };
  }

  const b = imminentBills[0];
  if (b) {
    const daysUntil = b.nextBilling
      ? Math.ceil((new Date(b.nextBilling).getTime() - now.getTime()) / DAY_MS)
      : null;
    return {
      kind: "imminent-bill",
      title: b.name,
      context: `${b.amount !== null ? `${b.amount}${b.currency ? ` ${b.currency}` : ""} · ` : ""}${daysUntil !== null ? `renews in ${daysUntil}d` : "renews soon"}`,
      href: "/money",
      lokiPrompt: `Subscription renewal coming up:\n\n${b.name}${b.amount !== null ? ` — ${b.amount}${b.currency ? ` ${b.currency}` : ""}` : ""}${daysUntil !== null ? ` in ${daysUntil} days` : ""}.\n\nIs this still pulling its weight? Anything to flag?`,
    };
  }

  const e = imminentEvents[0];
  if (e) {
    const daysUntil = e.deadline
      ? Math.ceil((new Date(e.deadline).getTime() - now.getTime()) / DAY_MS)
      : null;
    return {
      kind: "imminent-event",
      title: e.name,
      context: daysUntil !== null ? (daysUntil <= 0 ? "Today" : `In ${daysUntil}d`) : "Soon",
      href: "/events",
      lokiPrompt: `A deadline is approaching:\n\n${e.name}${daysUntil !== null ? ` — ${daysUntil} days away` : ""}.\n\nWhat needs to happen between now and then?`,
    };
  }

  const sc = staleContacts[0];
  if (sc) {
    const lastDate = sc.last_interaction ? new Date(sc.last_interaction) : null;
    const daysSince = lastDate ? Math.floor((now.getTime() - lastDate.getTime()) / DAY_MS) : null;
    const firstName = sc.name.split(/\s+/)[0] ?? sc.name;
    return {
      kind: "stale-contact",
      title: sc.name,
      context: daysSince !== null ? `Last interaction ${daysSince}d ago` : "No recent interaction",
      href: `/people?health=fading`,
      lokiPrompt: `A relationship is going stale:\n\n${sc.name}${daysSince !== null ? ` — last interaction ${daysSince} days ago` : ""}.\n\nDraft a warm, short check-in message I can send to ${firstName}. Keep it natural, no business angle, in the tone I'd actually use.`,
    };
  }

  const s = stalledGoals[0];
  if (s) {
    const daysIdle = Math.floor((now.getTime() - new Date(s.updatedAt).getTime()) / DAY_MS);
    const progress = s.progress ?? 0;
    return {
      kind: "stalled-goal",
      title: s.title,
      context: `${progress}% done · ${daysIdle}d idle`,
      href: "/goals",
      lokiPrompt: `A goal has stalled:\n\nGoal: ${s.title}\nProgress: ${progress}%\nIdle for ${daysIdle} days.\n\nIs this still worth pursuing? If yes, what's the smallest unblock?`,
    };
  }

  return null;
}
