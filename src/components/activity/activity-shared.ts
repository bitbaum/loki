import { APP_LOCALE, DEFAULT_TIMEZONE } from "@/lib/constants";
import type { DigestWindow } from "@/db/queries/digests";
import type { ActivityFilter, ActivityOutcome } from "@/lib/activity-events";
import type { StatusTone } from "@/lib/constants/statuses";

// Density used to be a page-wide compact/detailed switch. It is gone: each row
// now expands on its own, so "show me more of THIS one" no longer means
// "reflow the entire page". The URL param is ignored rather than redirected —
// an old bookmark still lands on a working page.

// ─── Labels (humanized variants of the typed enums) ──────────────────────────

export const WINDOW_LABEL: Record<DigestWindow, string> = {
  hour: "Hour",
  day: "Day",
  week: "Week",
  month: "Month",
};

export const RANGE_LABEL: Record<DigestWindow, string> = {
  hour: "the last hour",
  day: "the last 24 hours",
  week: "the last 7 days",
  month: "the last 30 days",
};

export const FILTER_LABEL: Record<ActivityFilter, string> = {
  all: "All",
  attention: "Needs attention",
  running: "Running",
  queued: "Queued",
  done: "Done",
};

// ─── Status → dot class (SSOT for the colored circles) ──────────────────────

export const STATUS_DOT_CLASS: Record<StatusTone, string> = {
  negative: "ui-dot-negative",
  warning: "ui-dot-warning",
  positive: "ui-dot-positive",
  neutral: "bg-text-tertiary",
};

/**
 * Outcome → tag variant. Paired with the base `.ui-tag` class at every call
 * site: `.ui-tag-*` alone sets colors and a border-COLOR, but not the border
 * width, radius or padding that make it read as a chip.
 */
export const OUTCOME_TAG_CLASS: Record<ActivityOutcome, string> = {
  error: "ui-tag-negative",
  unconfirmed: "ui-tag-negative",
  timeout: "ui-tag-negative",
  hang: "ui-tag-negative",
  user_abort: "ui-tag-warning",
  partial: "ui-tag-warning",
  running: "ui-tag-accent",
  success: "ui-tag-positive",
  dispatched: "ui-tag-neutral",
};

// ─── URL builder for in-page navigations ─────────────────────────────────────
// All filter changes (window, project, status) flow through this.
// Defaults are stripped so URLs stay clean: /activity for the default view.

export function activityHref(opts: {
  window?: DigestWindow;
  project?: string | null;
  filter?: ActivityFilter;
}): string {
  const params = new URLSearchParams();
  if (opts.window && opts.window !== "day") params.set("window", opts.window);
  if (opts.project) params.set("project", opts.project);
  if (opts.filter && opts.filter !== "all") params.set("status", opts.filter);
  const qs = params.toString();
  return qs ? `/activity?${qs}` : "/activity";
}

// ─── Time formatting ─────────────────────────────────────────────────────────
//
// Every formatter here pins `timeZone`. Without it they read the RUNTIME's
// zone — UTC on the box, Europe/Zurich in the browser — and the components
// calling them are "use client", so they render in BOTH places: the server
// wrote 10:18 and hydration wrote 12:18. React discarded the tree, which is
// React #418 on /activity at every viewport, in production only.
//
// Measured on a single page load 2026-09-05: 1798 words server, 1798 client,
// every clock differing by exactly two hours.
//
// Pinning beats the mounted-gate the greeting uses: these are PAST events, not
// "now", so there is no reader-dependent answer to defer to — deferring would
// trade a wrong first paint for an empty one. DEFAULT_TIMEZONE is already the
// app's SSOT for the operator's zone.

/** Full stamp — used where a date is genuinely needed (range labels). */
export function formatActivityTime(iso: string): string {
  return new Date(iso).toLocaleString(APP_LOCALE, {
    timeZone: DEFAULT_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Clock only. Rows live under a day heading, so repeating the date on all
 * twenty of them (the old "26 Aug, 04:00" on every line) spent the scarcest
 * column on the least surprising fact.
 */
export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(APP_LOCALE, {
    timeZone: DEFAULT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "Today" / "Yesterday" / "Mon, 25 Aug" for a YYYY-MM-DD bucket key.
 *
 * Compared as calendar-date STRINGS in a fixed zone, not by Date arithmetic.
 * `new Date(y, m-1, d)` and `now.getFullYear()` both read the runtime's zone,
 * so between 00:00 and 02:00 Zurich the box (UTC, still on yesterday) and the
 * browser (CEST, already on today) disagreed about which bucket is "Today" —
 * the same hydration mismatch as the clocks above, in a two-hour window. That
 * is why /activity failed on some runs and not others before the whole file
 * was pinned.
 */
export function formatDayHeading(day: string, now = new Date()): string {
  // en-CA renders ISO-shaped YYYY-MM-DD, which is exactly the bucket key format.
  const key = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: DEFAULT_TIMEZONE });
  if (day === key(now)) return "Today";
  if (day === key(new Date(now.getTime() - 86_400_000))) return "Yesterday";

  // Build the date as UTC midnight and render it as UTC: the key names a
  // calendar day, not an instant, so no zone conversion should shift it.
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString(APP_LOCALE, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * The label for one pulse bucket. Granularity follows the window: an hour-long
 * window is read in minutes, a month in dates. Printing "26 Aug, 04:00" on a
 * month chart's 30 bars would be noise; printing "04" on a week chart would be
 * ambiguous.
 */
export function formatPulseBucketLabel(iso: string, digestWindow: DigestWindow): string {
  const date = new Date(iso);
  if (digestWindow === "hour" || digestWindow === "day") {
    return date.toLocaleTimeString(APP_LOCALE, {
      timeZone: DEFAULT_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString(APP_LOCALE, {
    timeZone: DEFAULT_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
