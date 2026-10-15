/**
 * What "today", "tomorrow" and "Monday" mean for this person, right now.
 *
 * Loki was never told the date. Asked on the live site (2026-10-15) to "put an
 * event in my calendar: dentist appointment on Monday at 9am", it answered
 * that "the calendar date for Monday is not in your data" and asked the
 * person to work it out — the one thing a calendar assistant is for. The
 * records carry UTC timestamps; a person says "tonight" in their own zone.
 *
 * Pure: a clock and a zone in, one prompt line out.
 */
import { DEFAULT_TIMEZONE } from "@/lib/constants";

function isTimeZone(tz: string | null | undefined): tz is string {
  if (!tz?.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/** Where the person is: the travel zone while it lasts, else home, else the default. */
export function effectiveTimeZone(
  prefs: {
    homeTimezone?: string | null;
    currentTimezone?: string | null;
    currentCityUntil?: string | Date | null;
  } | null,
  now: Date = new Date(),
): string {
  const until = prefs?.currentCityUntil ? new Date(prefs.currentCityUntil) : null;
  // A trip's last day counts in full — "until 18 Oct" means through the 18th.
  const travelling =
    isTimeZone(prefs?.currentTimezone) &&
    (!until || Number.isNaN(until.getTime()) || now.getTime() < until.getTime() + 86_400_000);
  if (travelling) return prefs!.currentTimezone!.trim();
  if (isTimeZone(prefs?.homeTimezone)) return prefs!.homeTimezone!.trim();
  return DEFAULT_TIMEZONE;
}

export function nowLine(now: Date, timeZone: string): string {
  const tz = isTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return `\n\nIt is now ${when} where the operator is (${tz}). Work out "today", "tomorrow", "tonight", "Monday" and "next week" from this yourself and write the actual date; never ask the operator for a date you can work out.`;
}
