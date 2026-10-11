/**
 * What could this person do next on the fronts that are not code — ranked
 * from THEIR records, like the build row (lib/build-suggestions/rank.ts).
 *
 * The same rules hold here, so a change to one is a change in one place:
 *
 *   - Every suggestion names the fact it came from (`why`).
 *   - A thing Loki can carry forward is a prompt it answers (a draft to
 *     reconnect, a keep-or-cancel call on a renewal, the first piece of a
 *     deadline). A thing only the person can do (check off a habit, accept
 *     a delivery) OPENS the place it is done — no prompt pretends otherwise.
 *   - Nothing here dispatches into a project. Life suggestions never carry
 *     `project`; the build ranker owns that path.
 *   - Scores sit on the build ranker's scale so the two merge honestly:
 *     someone waiting on you (a delivered crew task) outranks a renewal, a
 *     renewal outranks a note to reconnect.
 *
 * Pure: no DB, no fetch, no clock reads — `now` is an input.
 */
import { HUMAN_TASK_STATUS, isHabitScheduled, type HabitFrequency } from "@/lib/constants/statuses";
import { HEALTH_FADING_DAYS } from "@/lib/constants/people";
import { DAY_MS } from "@/lib/constants/time";
import type { Suggestion } from "./types";

export type LifeInputs = {
  habits: {
    id: string;
    title: string;
    frequency: HabitFrequency;
    doneToday: boolean;
    streak: number;
  }[];
  renewals: {
    id: string;
    name: string;
    amount: number | null;
    currency: string | null;
    frequency: string | null;
    nextCharge: string;
  }[];
  /** People whose last interaction is older than the fading window, or unknown. */
  stalePeople: { id: string; name: string; lastInteraction: string | null }[];
  crewTasks: {
    id: string;
    title: string;
    status: string;
    assigneeName: string | null;
    updatedAt: string;
  }[];
  goalsDue: { id: string; title: string; progress: number; targetDate: string }[];
  eventsDue: { id: string; title: string; type: string; deadline: string }[];
};

export const EMPTY_LIFE_INPUTS: LifeInputs = {
  habits: [],
  renewals: [],
  stalePeople: [],
  crewTasks: [],
  goalsDue: [],
  eventsDue: [],
};

const RECONNECT_MAX = 3;
const HANDOVER_AFTER_DAYS = 2;
const LABEL_MAX = 44;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function daysBetween(from: string | Date, to: Date): number {
  return Math.round((to.getTime() - new Date(from).getTime()) / DAY_MS);
}

/** "today", "tomorrow", "in 3 days", "3 days ago". */
function inDays(date: string, now: Date): string {
  const d = daysBetween(now, new Date(date));
  if (d <= 0) return d === 0 ? "today" : `${-d} day${d === -1 ? "" : "s"} ago`;
  if (d === 1) return "tomorrow";
  return `in ${d} days`;
}

function money(amount: number | null, currency: string | null): string {
  if (amount === null) return "";
  return ` ${currency ?? "CHF"} ${amount % 1 === 0 ? amount : amount.toFixed(2)}`;
}

export function lifeCandidates(inputs: LifeInputs, now: Date = new Date()): Suggestion[] {
  const out: Suggestion[] = [];
  const dow = now.getDay();

  for (const h of inputs.habits) {
    if (h.doneToday || !isHabitScheduled(h.frequency, dow)) continue;
    const onStreak = h.streak > 0;
    out.push({
      id: `habit:${h.id}`,
      kind: "habit",
      label: onStreak ? `Keep the streak: ${h.title}` : `Today: ${h.title}`,
      why: onStreak
        ? `${h.streak}-day streak, not checked off yet today.`
        : "Scheduled for today, not checked off yet.",
      prompt: null,
      project: null,
      href: "/today#habits",
      // A live streak is worth more the longer it is — and worth most today,
      // because tomorrow it is gone.
      score: 40 + Math.min(h.streak, 30),
    });
  }

  for (const r of inputs.renewals) {
    const when = inDays(r.nextCharge, now);
    out.push({
      id: `renewal:${r.id}`,
      kind: "renewal",
      label: `Renews ${when}: ${r.name}`,
      why: `${r.name}${money(r.amount, r.currency)} is charged ${when}.`,
      prompt: `${r.name}${money(r.amount, r.currency)}${r.frequency ? ` (${r.frequency})` : ""} renews ${when}. Tell me what you know about how I use it, and whether to keep it, downgrade it, or cancel it. If cancel, draft the cancellation and put it in my approval queue.`,
      project: null,
      href: null,
      score: 45 + Math.max(0, 7 - Math.max(0, daysBetween(now, new Date(r.nextCharge)))),
    });
  }

  const stale = [...inputs.stalePeople]
    .sort((a, b) => {
      // Most recently seen first: the relationship that just went quiet is the
      // one a message still revives.
      const ta = a.lastInteraction ? new Date(a.lastInteraction).getTime() : 0;
      const tb = b.lastInteraction ? new Date(b.lastInteraction).getTime() : 0;
      return tb - ta;
    })
    .slice(0, RECONNECT_MAX);
  for (const p of stale) {
    const days = p.lastInteraction ? daysBetween(p.lastInteraction, now) : null;
    const since = days === null ? "a long time" : `${days} days`;
    out.push({
      id: `reconnect:${p.id}`,
      kind: "reconnect",
      label: `Reconnect with ${p.name}`,
      why:
        days === null
          ? `No logged conversation with ${p.name} yet.`
          : `Last conversation with ${p.name} was ${days} days ago.`,
      prompt: `I have not been in touch with ${p.name} for ${since}. Draft a short, warm message to reconnect, in my voice, using what you know about them, and put it in my approval queue.`,
      project: null,
      href: null,
      score: 30 + (days !== null && days < HEALTH_FADING_DAYS * 2 ? 5 : 0),
    });
  }

  for (const t of inputs.crewTasks) {
    if (t.status === HUMAN_TASK_STATUS.DELIVERED) {
      out.push({
        id: `crew_review:${t.id}`,
        kind: "crew_review",
        label: `Check ${t.assigneeName ?? "their"} delivery: ${t.title}`,
        why: `${t.assigneeName ?? "The assignee"} says it is done and is waiting on your yes.`,
        prompt: null,
        project: null,
        href: "/crew",
        score: 85,
      });
    } else if (
      t.status === HUMAN_TASK_STATUS.DRAFT &&
      daysBetween(t.updatedAt, now) >= HANDOVER_AFTER_DAYS
    ) {
      out.push({
        id: `crew_handover:${t.id}`,
        kind: "crew_handover",
        label: `Hand over: ${t.title}`,
        why: `Written ${daysBetween(t.updatedAt, now)} days ago, never handed to anyone.`,
        prompt: null,
        project: null,
        href: "/crew",
        score: 35,
      });
    }
  }

  for (const g of inputs.goalsDue) {
    if (g.progress >= 100) continue;
    const when = inDays(g.targetDate, now);
    const left = Math.max(0, daysBetween(now, new Date(g.targetDate)));
    out.push({
      id: `goal_due:${g.id}`,
      kind: "goal_due",
      label: `Due ${when}: ${g.title}`,
      why: `Goal at ${g.progress}%, target ${when}.`,
      prompt: `My goal "${clip(g.title, 200)}" is at ${g.progress}% and due ${when}. Say what still stands between here and done, pick the piece that moves it most this week, and give me the line that starts it.`,
      project: null,
      href: null,
      score: 60 + Math.max(0, 14 - left),
    });
  }

  for (const e of inputs.eventsDue) {
    const when = inDays(e.deadline, now);
    const left = Math.max(0, daysBetween(now, new Date(e.deadline)));
    out.push({
      id: `event_due:${e.id}`,
      kind: "event_due",
      label: `${e.type === "deadline" ? "Deadline" : "Closes"} ${when}: ${e.title}`,
      why: `${e.title} is ${when}.`,
      prompt: `"${clip(e.title, 200)}" is ${when}. Tell me what should be ready for it, pick the first piece the fleet can prepare, and give me the line that starts it.`,
      project: null,
      href: null,
      score: 55 + Math.max(0, 7 - left),
    });
  }

  return out.map((s) => ({ ...s, label: clip(s.label, LABEL_MAX) }));
}
