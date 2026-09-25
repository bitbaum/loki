/**
 * Calendar-event booking — the real effect behind an approved CREATE_EVENT action.
 *
 * SSOT for turning a Loki-proposed event payload into a Google Calendar event via
 * the locally-authenticated `gog` CLI (the same tool the /today calendar card
 * reads from). No googleapis/OAuth stack — we reuse gog's existing token bucket.
 *
 * Security: every user-derived field (title, location, times) is passed to gog as
 * an argv element through `runToolArgs` (execFile, no shell), never interpolated
 * into a shell string. See lib/tools.ts.
 */
import type { ActionPayload } from "@/db/schema/actions";
import { runToolArgs } from "@/lib/tools";
import { callGroqText, GROQ_FAST_MODEL } from "@/lib/groq";
import { DAY_MS, HOUR_MS, HTTP_TIMEOUT_SHORT_MS } from "@/lib/constants/time";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_CALENDAR = "primary";

/**
 * Which `gog` binary to invoke. Defaults to `gog` on PATH — on the box that is a
 * safety shim that refuses calendar writes and tells the agent to route through
 * the approval queue. The post-approval calendar drain (the ONE sanctioned
 * executor) sets GOG_BIN=/usr/local/bin/gog.real to reach the real binary,
 * bypassing the shim for approved events only. Kept as an env override (not a
 * PATH/symlink trick) so the bypass is scoped to that single process and never
 * re-opens the shim for the OpenClaw gateway running as the same user.
 */
const GOG_BIN = process.env.GOG_BIN?.trim() || "gog";

export type ResolvedEventTimes = {
  /** RFC3339 instant, or YYYY-MM-DD when allDay. */
  from: string;
  to: string;
  allDay: boolean;
};

/**
 * Derive concrete start/end from whatever Loki filled in. Precedence:
 *   1. eventStart (+ eventEnd, else +1h)         — precise, preferred
 *   2. eventDate  — date-only ⇒ all-day (1 day); datetime ⇒ +1h block
 * Returns null when there is no usable time at all (caller must not book).
 */
export function resolveEventTimes(
  payload: ActionPayload | null | undefined,
): ResolvedEventTimes | null {
  const forceAllDay = payload?.allDay === true;
  const start = typeof payload?.eventStart === "string" ? payload.eventStart.trim() : "";
  const end = typeof payload?.eventEnd === "string" ? payload.eventEnd.trim() : "";
  const date = typeof payload?.eventDate === "string" ? payload.eventDate.trim() : "";

  const source = start || date;
  if (!source) return null;

  // All-day: either forced, or the only signal is a bare calendar day.
  if (forceAllDay || (!start && DATE_ONLY.test(date))) {
    const day = (start || date).slice(0, 10);
    const t = Date.parse(`${day}T00:00:00Z`);
    if (Number.isNaN(t)) return null;
    // Google treats an all-day `end` as exclusive → next day for a single-day event.
    const endDay =
      end && DATE_ONLY.test(end) ? end : new Date(t + DAY_MS).toISOString().slice(0, 10);
    return { from: day, to: endDay, allDay: true };
  }

  const fromMs = Date.parse(source);
  if (Number.isNaN(fromMs)) return null;
  const endMs = end ? Date.parse(end) : NaN;
  const toMs = !Number.isNaN(endMs) && endMs > fromMs ? endMs : fromMs + HOUR_MS;
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), allDay: false };
}

/**
 * Has this event's slot already gone by? Pure, so the rule that RETIRES rows
 * can be asserted directly instead of trusted.
 *
 * Used by the approval-queue reaper (api/crons/check-pending-approvals): a
 * draft calendar event whose end has passed is not a pending decision — booking
 * it would put an event in the past. The two "false" cases are the important
 * ones: an unparseable time and a payload with no structured time at all both
 * mean *we do not know*, and unknown must never be treated as expired. Those
 * rows age out on the queue's ordinary time limit instead.
 *
 * All-day events resolve to an EXCLUSIVE end date (a one-day event on the 5th
 * ends on the 6th), so "today" is correctly still live.
 */
export function isEventSlotPassed(
  payload: ActionPayload | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const times = resolveEventTimes(payload);
  if (!times) return false;
  const endMs = Date.parse(times.to);
  return !Number.isNaN(endMs) && endMs < nowMs;
}

/**
 * Build the `gog calendar create` argv for an event. Pure (no I/O) so it can be
 * asserted directly in tests. Returns null when the payload can't be booked
 * (no title or no usable time).
 */
export function buildGogCreateArgs(
  payload: ActionPayload | null | undefined,
  fallbackTitle: string,
  calendarId: string = DEFAULT_CALENDAR,
): string[] | null {
  const title =
    (typeof payload?.eventTitle === "string" && payload.eventTitle.trim()) || fallbackTitle.trim();
  if (!title) return null;
  const times = resolveEventTimes(payload);
  if (!times) return null;

  const args = [
    "calendar",
    "create",
    calendarId,
    "--json",
    "--summary",
    title,
    "--from",
    times.from,
    "--to",
    times.to,
  ];
  if (times.allDay) args.push("--all-day");
  const location = typeof payload?.eventLocation === "string" ? payload.eventLocation.trim() : "";
  if (location) args.push("--location", location);
  return args;
}

export type BookEventResult =
  { ok: true; eventId?: string; htmlLink?: string } | { ok: false; error: string };

/**
 * Agents sometimes propose a calendar event with a MESSAGE-shaped payload
 * (subject + a free-text body like "Time: Friday, July 24, 2026, 18:00 - 22:00
 * (Europe/Zurich)\nLocation: …") instead of the structured eventStart/eventDate
 * fields the booker needs — so resolveEventTimes returns null and nothing ever
 * books. When the structured fields are missing, recover them from that free text
 * with a Groq JSON pass (it parses the human/German dates the pure resolver
 * can't). Best-effort: returns the payload unchanged when there's no text, no
 * GROQ key, or the parse fails — the caller then reports the honest
 * "missing date/time" error instead of booking garbage.
 */
export type EventRecovery = (
  payload: ActionPayload | null | undefined,
  fallbackTitle: string,
) => Promise<ActionPayload | null | undefined>;

/** Passed IN by callers acting on a person's tap, never reached by default: a
 *  standing rule executes from a cron tick with nobody asking, and a model call
 *  there would spend the box's shared free tier (2026-09-25). */
export const recoverEventPayloadFromText: EventRecovery = async (payload, fallbackTitle) => {
  if (!process.env.GROQ_API_KEY) return payload;
  const text = [payload?.subject, payload?.body, payload?.eventTitle, fallbackTitle]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join("\n");
  if (!text) return payload;

  const system = `Extract calendar-event fields from the text. Respond with ONE JSON object only:
{"eventTitle":"<short title>","eventStart":"<RFC3339 start, or omit>","eventEnd":"<RFC3339 end, or omit>","eventDate":"<YYYY-MM-DD when only a day is known, or omit>","eventLocation":"<place, or omit>","allDay":<true when there is no time-of-day>}
Resolve relative/human/German dates against the current time; output absolute values. Include the timezone offset in eventStart/eventEnd when the text names one. eventLocation must be a real place (venue, address, or city) — never a timezone, an organization name, or a note; omit it if none is given. Omit any field you cannot determine.`;
  let raw: string;
  try {
    raw = await callGroqText(`Current time: ${new Date().toISOString()}\n\nText:\n${text}`, {
      feature: "calendar-extract",
      systemPrompt: system,
      model: GROQ_FAST_MODEL,
      maxTokens: 300,
      temperature: 0,
      timeoutMs: HTTP_TIMEOUT_SHORT_MS,
    });
  } catch {
    return payload;
  }
  const s = raw.indexOf("{"),
    e = raw.lastIndexOf("}");
  if (s === -1 || e <= s) return payload;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(s, e + 1));
  } catch {
    return payload;
  }
  const pick = (k: string) =>
    typeof obj[k] === "string" && (obj[k] as string).trim() ? (obj[k] as string).trim() : undefined;
  const merged: ActionPayload = { ...(payload ?? {}) };
  merged.eventTitle ??= pick("eventTitle");
  merged.eventStart ??= pick("eventStart");
  merged.eventEnd ??= pick("eventEnd");
  merged.eventDate ??= pick("eventDate");
  merged.eventLocation ??= pick("eventLocation");
  if (merged.allDay === undefined && obj.allDay === true) merged.allDay = true;
  return merged;
};

/**
 * Book the event by running gog. Assumes the caller already checked the local
 * runtime is available (gog only exists there). Reversible: a wrong booking can
 * be deleted from the calendar — but we still only run behind the approval gate.
 */
/**
 * Resolve the `gog calendar create` argv for a payload, recovering structured
 * fields from free text when they're missing (see recoverEventPayloadFromText).
 * Exported so a repair/dry-run can inspect what WOULD be booked without running
 * gog. Returns null when the event still can't be resolved.
 */
export async function resolveGogCreateArgs(
  payload: ActionPayload | null | undefined,
  fallbackTitle: string,
  recover?: EventRecovery,
): Promise<string[] | null> {
  if (buildGogCreateArgs(payload, fallbackTitle)) {
    return buildGogCreateArgs(payload, fallbackTitle);
  }
  if (!recover) return null;
  const enriched = await recover(payload, fallbackTitle).catch(() => payload);
  return buildGogCreateArgs(enriched, fallbackTitle);
}

export async function bookCalendarEvent(
  payload: ActionPayload | null | undefined,
  fallbackTitle: string,
  recover?: EventRecovery,
): Promise<BookEventResult> {
  // Structured fields present → book directly. Missing → recover from free text,
  // but only when the caller passed a recovery (see recoverEventPayloadFromText).
  const args = await resolveGogCreateArgs(payload, fallbackTitle, recover);
  if (!args) return { ok: false, error: "missing title or date/time in event payload" };

  const res = await runToolArgs(GOG_BIN, args, 20000);
  if (!res.ok) return { ok: false, error: res.error ?? "gog calendar create failed" };

  // gog --json returns the created event; surface id/link for the audit trail.
  try {
    const parsed = JSON.parse(res.data ?? "{}");
    const event = parsed?.event ?? parsed?.result ?? parsed;
    return { ok: true, eventId: event?.id, htmlLink: event?.htmlLink };
  } catch {
    // A non-JSON success (older gog) is still a success — the exit code was 0.
    return { ok: true };
  }
}
