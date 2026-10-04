/**
 * The prompt behind "Brief Loki" on /today.
 *
 * Extracted from SummaryBar so it can be tested. It could not be before — it
 * was an inline array inside an async server component, which is why two bugs
 * lived in it unnoticed until someone read the field's value in a browser:
 *
 *   1. `.filter(Boolean)` deleted the paragraph breaks. The array carries two
 *      deliberate `""` separators between the heading, the counts and the
 *      question. An empty string is falsy, so the filter meant to drop absent
 *      counts dropped those too, and the three parts ran together.
 *
 *   2. The control it fills was an `<input>`, which cannot hold a newline, so
 *      the browser stripped whatever survived. Measured 2026-09-18: the field
 *      contained "Daily brief — Friday, 18 SeptemberWhat should I focus on
 *      today?" with a newline count of zero. Fixed in AskLokiButton; this file
 *      fixes the string it is handed.
 *
 * Both were silent. Nothing threw, nothing logged, and the prompt still read
 * as roughly sensible prose — which is exactly why it survived: a mangled
 * prompt looks like a wording choice, not a defect.
 */

export type TodayBriefCounts = {
  activeGoals: number;
  avgGoalProgress: number;
  habitsDone: number;
  habitsTotal: number;
  goalsDueSoon: number;
  stuckGoals: number;
  eventsDueSoon: number;
  overdueCommitments: number;
  staleContacts: number;
  pendingDrafts: number;
  urgentAlerts: number;
};

export type TodayBriefFleet = {
  running: number;
  waiting: number;
  degraded: number;
};

export const TODAY_BRIEF_QUESTION =
  "What should I focus on today? What's the most urgent thing I'm likely to overlook?";

/**
 * Build the brief.
 *
 * `heading` is passed in rather than formatted here so the caller owns the
 * locale — and so a test can assert the shape without depending on today's
 * date or the machine's locale.
 */
/** The day's counts as plain lines, absent ones dropped. Shared by the brief
 *  and by "Plan my day" / "Wrap up day", so Loki plans from the same facts. */
export function todayBriefFacts(s: TodayBriefCounts, fleet: TodayBriefFleet): string[] {
  const fleetParts = [
    fleet.running > 0 && `${fleet.running} running`,
    fleet.waiting > 0 && `${fleet.waiting} waiting`,
    fleet.degraded > 0 && `${fleet.degraded} degraded`,
  ].filter((p): p is string => typeof p === "string");
  return [
    s.activeGoals > 0 && `Goals: ${s.activeGoals} active, ${s.avgGoalProgress}% average progress`,
    s.habitsTotal > 0 && `Habits: ${s.habitsDone}/${s.habitsTotal} done today`,
    s.goalsDueSoon > 0 && `Goals due soon: ${s.goalsDueSoon}`,
    s.stuckGoals > 0 && `Stalled goals: ${s.stuckGoals}`,
    s.eventsDueSoon > 0 && `Events with upcoming deadlines: ${s.eventsDueSoon}`,
    s.overdueCommitments > 0 && `Overdue commitments: ${s.overdueCommitments}`,
    s.staleContacts > 0 && `Contacts needing attention: ${s.staleContacts}`,
    s.pendingDrafts > 0 && `Pending action drafts: ${s.pendingDrafts}`,
    s.urgentAlerts > 0 && `Urgent alerts: ${s.urgentAlerts}`,
    fleetParts.length > 0 && `Agent fleet: ${fleetParts.join(", ")}`,
  ].filter((line): line is string => typeof line === "string");
}

/**
 * A day-phase prompt ("Plan my day", "Wrap up day") with today's facts
 * appended, so the one button does what "Brief Loki" did beside it. They were
 * two buttons asking Loki the same thing with different context.
 */
export function withTodayFacts(prompt: string, facts: string[]): string {
  return facts.length === 0 ? prompt : `${prompt}\n\nToday so far:\n${facts.join("\n")}`;
}

export function buildTodayBriefPrompt(
  heading: string,
  s: TodayBriefCounts,
  fleet: TodayBriefFleet,
): string {
  const lines: string[] = [heading, "", ...todayBriefFacts(s, fleet), "", TODAY_BRIEF_QUESTION];

  return (
    lines
      // Absent counts were already dropped by todayBriefFacts; the "" separators
      // stay. `.filter(Boolean)` would delete them too, which is bug 1 above.
      .join("\n")
      // With every count absent the two separators end up adjacent, which would
      // open the prompt with a gap. Collapse runs rather than making the
      // separators conditional — one rule beats a condition per line.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
