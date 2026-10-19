import { APP_NAME } from "@/config/brand";

// Goals with 0% progress older than this are considered stalled.
export const STALE_GOALS_DAYS = 30;

// Max stuck goals shown on the Today page.
export const STUCK_GOALS_LIMIT = 5;

// Recent orchestration runs window shown on Today.
export const RECENT_RUNS_HOURS = 24;
export const RECENT_RUNS_LIMIT = 6;

/**
 * Grace period before the Approval Queue advisor applies its recommendation on
 * its own. Long enough to read the headline and hit Hold, short enough that a
 * queue of noise clears itself while you watch.
 */
export const ADVICE_AUTO_APPLY_SECONDS = 8;

// How many days ahead the calendar tool fetches.
export const CALENDAR_LOOKAHEAD_DAYS = 2;

// Location used by the weather widget.
export const WEATHER_CITY = "Zurich";

/** Local hour from which Today offers "wrap up" instead of "plan". */
export const EVENING_FROM_HOUR = 17;

/** Zero-project Today: one action, no empty-card wall. */
export const FIRST_RUN = {
  title: "Add a project.",
  body: "Then you can tell the fleet what to do.",
  cta: "Open Home",
} as const;

export const PLAN_DAY_PROMPT = `Plan my day.

Check in ${APP_NAME} and the codebase:
- Which of my active projects has the most urgent open work or is blocking a goal?
- Which goals are due soon or have been stuck at 0% for 30+ days?
- Are there any commitments or events with deadlines in the next 3 days?
- Which habit am I most at risk of breaking today?

Then give me:
1. The ONE thing I should work on first today (be specific — project name + what exactly)
2. Three concrete tasks for it (each under 10 words)
3. One person I should reach out to and why

Under 150 words. No hedging.`;

export const WRAP_UP_PROMPT = `Run my end-of-day wrap-up.

1. Check git commits across all active projects since this morning — what actually shipped?
2. What is currently blocked or waiting on input?
3. Review open commitments — anything overdue or due tomorrow?
4. Did I make progress on my highest-priority goal today?
5. What is the single first task to do tomorrow morning?

Be direct. If nothing shipped, say so. Under 150 words.`;
