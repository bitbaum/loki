/**
 * Is this proposal the same request as one made a moment ago?
 *
 * One chat turn has two producers: the message is mined for an action
 * (enqueue-proposal.ts) while the model, in parallel, may call propose_action
 * for the very same ask. The pending-title unique index only catches an
 * identical title on a DRAFT — but on the live site (2026-10-15) one "dentist
 * on Monday at 9am" became "Dentist Appointment" from one and "Dentist
 * appointment" from the other, and with the standing "put appointments in my
 * calendar" rule both were approved at once: one ask, two bookings.
 *
 * Same request = same action type, titles that overlap word for word (one
 * contains the other: "Dentist" and "Dentist appointment"), and — when both
 * name a day — the same day. Pure; the caller supplies the recent rows.
 */

/** Two producers of one turn land seconds apart; a later ask is a new ask. */
export const SAME_REQUEST_WINDOW_MS = 10 * 60_000;

type Proposal = {
  type: string;
  title: string;
  payload?: Record<string, unknown> | null;
};

const FILLER = new Set(["a", "an", "the", "my", "with", "at", "on", "for", "to", "of"]);

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w && !FILLER.has(w)),
  );
}

function dayOf(payload: Record<string, unknown> | null | undefined): string | null {
  for (const key of ["eventStart", "eventDate", "dueDate"]) {
    const v = payload?.[key];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

function bodyOf(payload: Record<string, unknown> | null | undefined): string | null {
  const v = payload?.body;
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase().replace(/\s+/g, " ") : null;
}

export function isSameRequest(a: Proposal, b: Proposal): boolean {
  if (a.type !== b.type) return false;
  const wa = words(a.title);
  const wb = words(b.title);
  if (wa.size === 0 || wb.size === 0) return false;
  const [small, large] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  for (const w of small) if (!large.has(w)) return false;
  // Two messages to Anna are titled alike ("Message Anna"); what is said
  // tells them apart.
  const ba = bodyOf(a.payload);
  const bb = bodyOf(b.payload);
  if (ba && bb && ba !== bb) return false;
  const da = dayOf(a.payload);
  const db = dayOf(b.payload);
  return !da || !db || da === db;
}
