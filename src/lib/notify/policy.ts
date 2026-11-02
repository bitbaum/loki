/**
 * The owner's Telegram contract, as code. Every bot of the fleet (Loki, the
 * box, OrangeCat's Cat, …) reaches the owner through ONE gateway
 * (`deliverNotice`, lib/notify/deliver.ts), and this file decides what that
 * gateway may put on his phone.
 *
 * The owner's words, 2026-11-02, after a night of "⚙️ STILL FAILING:
 * run-p1977852-i194871759" every five minutes:
 *
 * > If you send me something, it has to be important for me. It has to be
 * > worth my time looking at the Telegram message, and then it should be
 * > actionable. I should read it and click one time, I shouldn't write
 * > anything there. "What exactly should I do with that information?" — this
 * > question should never appear in my mind.
 *
 * So the rules, each enforced below and pinned by scripts/test/notify-policy.ts:
 *
 *  1. NO ACTION, NO MESSAGE. A notice must carry at least one button, and a
 *     button is a verb plus an https link that does the thing (or opens the
 *     exact screen where one tap does it). A notice without one is recorded
 *     in Loki's list (/system or /today) and never reaches Telegram. The only
 *     exception is a digest the owner subscribed to (the day plan), and even
 *     that carries a button.
 *  2. ONE ROW OF AT MOST THREE BUTTONS, each label at most 24 characters, so
 *     the whole message and its buttons fit one phone screen.
 *  3. ONE INCIDENT IS ONE MESSAGE. A notice with a `key` already delivered is
 *     held, and reminders back off 30 min → 2 h → 8 h → a day.
 *  4. NO BOMBARDMENT, WHATEVER A SENDER'S BUG. At most 3 deliveries per source
 *     per hour and 12 per day across all sources; past that, notices go to the
 *     list only. A sender with a loop costs the owner nothing.
 *  5. QUIET NIGHTS. Only `urgency: "now"` makes a sound, and between 22:00
 *     and 07:00 (owner's time zone) nothing does — a "now" notice still
 *     arrives, silently, and the morning plan leads with it.
 */

import type { NotifyCategory } from "@/config/notify-categories";

export const NOTICE_URGENCIES = ["now", "today", "digest"] as const;
export type NoticeUrgency = (typeof NOTICE_URGENCIES)[number];

export type NoticeAction = {
  label: string;
  url: string;
  /**
   * Set only by Loki's own code for a link it composed from its own records
   * (a customer's own site, a signed approval link). Never accepted over HTTP
   * (lib/notify/schema.ts drops it), so a link chosen by an email or a bot can
   * never skip the host allowlist.
   */
  trusted?: boolean;
};

export type NoticeRequest = {
  /** Which bot is speaking: "loki", "box", "orangecat-cat", … Shown on the message. */
  source: string;
  /** One line: what happened, in the owner's terms. */
  title: string;
  /** At most a few short lines: why it matters and what the button does. */
  body?: string;
  /** The one-tap actions. Empty = not actionable = never on Telegram. */
  actions: NoticeAction[];
  /** "now": worth a sound. "today": silent. "digest": a subscribed summary. */
  urgency: NoticeUrgency;
  /** Same key = same incident: dedupe and back off on it. */
  key?: string;
  /** Speak it as a voice note too (paid feature, see lib/notify/voice.ts). */
  voice?: boolean;
  /** Deliver this key at most once, ever (until its row is closed): no reminders. */
  once?: boolean;
  /** Which kind of message this is — each person turns kinds on or off (config/notify-categories.ts). */
  category?: NotifyCategory;
  /**
   * false when the sender keeps its own row on /today (feedback, approvals…):
   * the notice is still recorded for the caps, but hidden, so the list does
   * not show the same thing twice.
   */
  listed?: boolean;
};

/** The kind of a notice: its own, else by who sent it. */
export function categoryOf(n: Pick<NoticeRequest, "category" | "source">): NotifyCategory {
  if (n.category) return n.category;
  if (n.source === "box") return "servers";
  if (n.source.startsWith("orangecat")) return "bots";
  return "results";
}

export const MAX_ACTIONS = 3;
export const MAX_LABEL = 24;
export const MAX_TITLE = 140;
export const MAX_BODY = 600;
export const PER_SOURCE_PER_HOUR = 3;
export const PER_DAY = 12;
export const BASE_REMINDER_MS = 30 * 60_000;
export const MAX_REMINDER_MS = 24 * 60 * 60_000;
export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 7;
export const OWNER_TIME_ZONE = "Europe/Zurich";

export type Refusal = { ok: false; reason: string };
export type Valid = { ok: true; notice: NoticeRequest };

/**
 * Hosts a button may open. A button in the owner's own bot is trusted by
 * reflex, so it must never point anywhere a sender's input chose: an email
 * that says "verify at https://evil…" read by the day-plan agent must not
 * become a one-tap phishing link. Own domains and the few services whose
 * pages are the action (mail, calendar, GitHub, Hetzner) only.
 */
export const ALLOWED_BUTTON_HOSTS = [
  /(^|\.)orangecat\.ch$/,
  /(^|\.)bitbaum\.(ch|com)$/,
  /^mail\.google\.com$/,
  /^calendar\.google\.com$/,
  /^github\.com$/,
  /^console\.hetzner\.cloud$/,
];

export function isAllowedButtonUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && ALLOWED_BUTTON_HOSTS.some((re) => re.test(u.hostname));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Shape rules (1, 2). Returns the cleaned notice or why it is refused. Only a
 * missing or unsafe action refuses: a long title or label is clipped, never
 * a reason to drop a real notice into the list.
 */
export function validateNotice(input: NoticeRequest): Valid | Refusal {
  const title = clip(input.title?.trim() ?? "", MAX_TITLE);
  if (!title) return { ok: false, reason: "a notice needs a title" };
  const body = input.body?.trim() ? clip(input.body.trim(), MAX_BODY) : undefined;
  const actions = (input.actions ?? [])
    .filter((a) => a?.label?.trim() && a?.url?.trim())
    .map((a) => ({
      label: clip(a.label.trim(), MAX_LABEL),
      url: a.url.trim(),
      trusted: a.trusted,
    }));
  if (actions.length === 0) {
    return {
      ok: false,
      reason:
        "not actionable: a notice needs at least one button (a verb and a link). It was recorded in the list instead",
    };
  }
  for (const a of actions) {
    const safe = a.trusted ? /^https:\/\//.test(a.url) : isAllowedButtonUrl(a.url);
    if (!safe) {
      return {
        ok: false,
        reason: `button "${a.label}" must open an https page on an allowed host`,
      };
    }
  }
  if (!NOTICE_URGENCIES.includes(input.urgency)) return { ok: false, reason: "unknown urgency" };
  return {
    ok: true,
    notice: {
      ...input,
      source: input.source.trim().slice(0, 40) || "loki",
      title,
      body,
      actions: actions.slice(0, MAX_ACTIONS),
    },
  };
}

/** What the gateway has already sent, as the policy needs to see it. */
export type DeliveryHistory = {
  /** Deliveries of this notice's key: when, and how many so far. Null = never. */
  lastForKey: { at: number; count: number } | null;
  /** Deliveries from this source in the last hour. */
  sourceLastHour: number;
  /** Deliveries from every source in the last 24 hours. */
  lastDay: number;
};

export type Decision =
  | { deliver: true; ring: boolean }
  | { deliver: false; reason: "held-reminder" | "source-cap" | "daily-cap"; retryAfterMs?: number };

/** Wait before the next reminder about the same key: 30 min, ×4 each time, capped at a day. */
export function reminderWaitMs(deliveredCount: number): number {
  const exp = Math.max(0, Math.min(3, deliveredCount - 1));
  return Math.min(BASE_REMINDER_MS * 4 ** exp, MAX_REMINDER_MS);
}

/** Hour of day in the owner's zone. */
export function ownerHour(now: number, timeZone = OWNER_TIME_ZONE): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(now));
  return Number(h) % 24;
}

export function isQuietHour(now: number, timeZone = OWNER_TIME_ZONE): boolean {
  const h = ownerHour(now, timeZone);
  return h >= QUIET_FROM_HOUR || h < QUIET_UNTIL_HOUR;
}

/** Rules 3–5: whether a valid notice goes out now, and whether it rings. */
export function decideDelivery(
  notice: NoticeRequest,
  history: DeliveryHistory,
  now: number,
): Decision {
  if (history.lastForKey && notice.once) return { deliver: false, reason: "held-reminder" };
  if (history.lastForKey) {
    const wait = reminderWaitMs(history.lastForKey.count);
    const age = now - history.lastForKey.at;
    if (age < wait) return { deliver: false, reason: "held-reminder", retryAfterMs: wait - age };
  }
  // The caps stop a looping sender, never an urgent one: a second break-in
  // attempt in the same hour is not noise.
  if (notice.urgency !== "now") {
    if (history.sourceLastHour >= PER_SOURCE_PER_HOUR)
      return { deliver: false, reason: "source-cap" };
    if (history.lastDay >= PER_DAY) return { deliver: false, reason: "daily-cap" };
  }
  return { deliver: true, ring: notice.urgency === "now" && !isQuietHour(now) };
}

/**
 * The message text: what happened and why, nothing to decode. No sender tag:
 * "orangecat-cat · …" (2026-11-02) told the owner a machine's name, not
 * anything to do. The source stays on the list row for whoever debugs it.
 */
export function formatNotice(notice: NoticeRequest): string {
  return [notice.title, notice.body].filter(Boolean).join("\n\n");
}
