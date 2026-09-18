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
export function buildTodayBriefPrompt(
  heading: string,
  s: TodayBriefCounts,
  fleet: TodayBriefFleet,
): string {
  const fleetParts = [
    fleet.running > 0 && `${fleet.running} running`,
    fleet.waiting > 0 && `${fleet.waiting} waiting`,
    fleet.degraded > 0 && `${fleet.degraded} degraded`,
  ].filter((p): p is string => typeof p === "string");

  const lines: (string | false)[] = [
    heading,
    "",
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
    "",
    TODAY_BRIEF_QUESTION,
  ];

  return (
    lines
      // Drop the absent COUNTS (false) and keep the intentional "" separators.
      // `.filter(Boolean)` cannot tell those apart, which is bug 1 above.
      .filter((line): line is string => line !== false)
      .join("\n")
      // With every count absent the two separators end up adjacent, which would
      // open the prompt with a gap. Collapse runs rather than making the
      // separators conditional — one rule beats a condition per line.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
