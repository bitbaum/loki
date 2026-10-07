/**
 * "It's late — go to sleep, autopilot has it." Operator, 2026-10-07: "when it's
 * late it should suggest to just go to sleep and do autopilot".
 *
 * Pure so the hours and the wording can be tested without a clock or a page.
 * The hours are the reader's LOCAL time: the browser decides, never the server.
 */
import type { AutoInjectMode } from "@/config/beacon";

/** From 23:00 until 05:00 local time. */
export const LATE_NIGHT_FROM_HOUR = 23;
export const LATE_NIGHT_UNTIL_HOUR = 5;

export function isLateNight(d: Date): boolean {
  const h = d.getHours();
  return h >= LATE_NIGHT_FROM_HOUR || h < LATE_NIGHT_UNTIL_HOUR;
}

/**
 * Which night this is, as the evening it started on (YYYY-MM-DD) — so "not
 * tonight" at 01:30 is the same night as at 23:10, and tomorrow asks again.
 */
export function nightKey(d: Date): string {
  const evening = new Date(d);
  if (d.getHours() < LATE_NIGHT_UNTIL_HOUR) evening.setDate(evening.getDate() - 1);
  const m = String(evening.getMonth() + 1).padStart(2, "0");
  const day = String(evening.getDate()).padStart(2, "0");
  return `${evening.getFullYear()}-${m}-${day}`;
}

export type LateNightCopy = {
  headline: string;
  detail: string;
  /** The one tap — only when there is something to switch on. */
  action: string | null;
};

export function lateNightCopy(mode: AutoInjectMode): LateNightCopy {
  return mode === "on"
    ? {
        headline: "It's late. Autopilot is on — go to sleep.",
        detail:
          "Agents keep working through each project's queue. When a fix goes live you get a message with a walkthrough of what changed.",
        action: null,
      }
    : {
        headline: "It's late. Hand it to autopilot and go to sleep.",
        detail:
          "Agents work through each project's queue and pick the next-best task by themselves. You wake up to what changed, with a walkthrough of each live fix.",
        action: "Turn on autopilot",
      };
}
