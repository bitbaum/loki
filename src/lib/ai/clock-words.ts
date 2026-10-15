/**
 * A moment as the person would say it: "at 13:35", "tomorrow at 02:00".
 *
 * Budget lines used to say "resets in 8 hours" and "unlocks in 19 minutes" —
 * two countdowns, in two different sentences, about the same budget, and a
 * person read them as a contradiction (2026-10-15). A clock time in their own
 * zone is one thing to remember and needs no arithmetic.
 *
 * Pure: the zone and the clock are passed in.
 */
import { DEFAULT_TIMEZONE } from "@/lib/constants";

function dayKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(d);
}

function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function atClock(at: Date, now: Date, timeZone?: string | null): string {
  const tz = safeZone(timeZone);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  const today = dayKey(now, tz);
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000), tz);
  const day = dayKey(at, tz);
  if (day === today) return `at ${time}`;
  if (day === tomorrow) return `tomorrow at ${time}`;
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(at);
  return `${weekday} at ${time}`;
}
