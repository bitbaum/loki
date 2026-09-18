/**
 * What survives from a pile of search results to a suggestion worth sending.
 *
 * Pure — no network, no model, no clock of its own — so the rules that decide
 * what reaches the operator can be asserted directly
 * (scripts/test/event-candidate.ts) rather than trusted. The I/O half lives in
 * lib/events/scout.ts.
 *
 * THE BIAS IS TOWARD DROPPING THINGS. A suggestion is an interruption with a
 * button on it, and a weekly message the operator learns to swipe past costs
 * more than the events it would have surfaced. So every rule below is written
 * to discard on doubt:
 *
 *   - a date we cannot read is a DROP, never a guess. The first search run
 *     while building this returned a Zurich meetup dated September 2025 as its
 *     top hit; "upcoming" in a listings page means nothing at all.
 *   - a date outside the horizon is a drop, including anything in the past.
 *   - something already proposed is a drop, however it is spelled.
 *   - something already REJECTED is a drop forever. That is the whole learning
 *     loop: the operator says no once, and the queue is the memory.
 */

/** An event the extractor believes it found. Everything here may be wrong. */
export type EventCandidate = {
  title: string;
  /** RFC3339, or a bare YYYY-MM-DD for something all-day. */
  startsAt?: string;
  endsAt?: string;
  location?: string;
  url?: string;
  /** From the topic that found it — grouping and the "why" line. */
  category: string;
  rationale: string;
};

export type ScreenedEvent = EventCandidate & {
  start: Date;
  end: Date;
  allDay: boolean;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Resolve a candidate's time, or null when it cannot be trusted.
 *
 * Mirrors the approval queue's own rule (lib/actions/calendar-event.ts): a bare
 * day is all-day with an exclusive end, a start with no end gets two hours —
 * not one, because an evening gig or a meetup is rarely an hour and the value
 * of this field is conflict detection, where under-stating the length is the
 * error that lets a clash through.
 */
export function resolveCandidateTimes(
  c: EventCandidate,
): { start: Date; end: Date; allDay: boolean } | null {
  const raw = c.startsAt?.trim();
  if (!raw) return null;

  if (DATE_ONLY.test(raw)) {
    const startMs = Date.parse(`${raw}T00:00:00Z`);
    if (Number.isNaN(startMs)) return null;
    const endRaw = c.endsAt?.trim();
    const endMs =
      endRaw && DATE_ONLY.test(endRaw) ? Date.parse(`${endRaw}T00:00:00Z`) : startMs + DAY_MS;
    if (Number.isNaN(endMs) || endMs <= startMs) return null;
    return { start: new Date(startMs), end: new Date(endMs), allDay: true };
  }

  const startMs = Date.parse(raw);
  if (Number.isNaN(startMs)) return null;
  const endParsed = c.endsAt ? Date.parse(c.endsAt) : NaN;
  const endMs = !Number.isNaN(endParsed) && endParsed > startMs ? endParsed : startMs + 2 * HOUR_MS;
  return { start: new Date(startMs), end: new Date(endMs), allDay: false };
}

/**
 * Normalise a title for dedupe.
 *
 * Listings sites spell the same evening a dozen ways ("Zurich AI Meetup #14",
 * "ZURICH AI MEETUP - Sept"), so comparing raw strings dedupes almost nothing
 * and the digest shows the same thing three times. Strips case, punctuation,
 * issue numbers and the city itself — none of which distinguish two events.
 */
export function dedupeKey(input: { title: string; url?: string }): string {
  const t = input.title
    .toLowerCase()
    .replace(/[#№]\s*\d+/g, " ")
    .replace(/\b(zurich|zürich|schweiz|switzerland)\b/g, " ")
    .replace(/[^a-z0-9äöü]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  // Host, not full URL: the same event under a tracking query string is one event.
  let host = "";
  try {
    if (input.url) host = new URL(input.url).host.replace(/^www\./, "");
  } catch {
    host = "";
  }
  return `${t}|${host}`;
}

export type ScreenInput = {
  candidates: EventCandidate[];
  now: Date;
  horizonDays: number;
  /** Dedupe keys already proposed or rejected — both mean "do not send this". */
  seenKeys: Set<string>;
  max: number;
};

/**
 * Screen, dedupe, order and cap.
 *
 * Ordering is soonest-first rather than by any score. A ranked feed invites the
 * question "why this order", and with every purpose selected there is no honest
 * answer — the operator said all four matter. What a diary genuinely has is a
 * shape in time, and the thing happening on Thursday is the thing you must
 * decide about before the thing three weeks out.
 */
export function screenCandidates(input: ScreenInput): ScreenedEvent[] {
  const horizonEnd = new Date(input.now.getTime() + input.horizonDays * DAY_MS);
  const seen = new Set(input.seenKeys);
  const out: ScreenedEvent[] = [];

  for (const c of input.candidates) {
    if (!c.title?.trim()) continue;

    const times = resolveCandidateTimes(c);
    if (!times) continue; // undated ⇒ dropped, never guessed

    // Already over, or beyond what we can believe. `end <= now` rather than
    // `start` so something running right now still counts as live.
    if (times.end.getTime() <= input.now.getTime()) continue;
    if (times.start.getTime() > horizonEnd.getTime()) continue;

    const key = dedupeKey(c);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ ...c, ...times });
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out.slice(0, input.max);
}
