/**
 * Does this proposed slot collide with something already in the calendar?
 *
 * Pure — no database, no clock of its own — so the rules below can be asserted
 * directly (scripts/test/calendar-conflict.ts) instead of trusted. The database
 * half lives in db/queries/calendar-busy.ts.
 *
 * THREE ANSWERS, NOT TWO. This is the whole design:
 *
 *   clear     — we looked, and the slot is free
 *   conflict  — we looked, and here is what it collides with
 *   unknown   — we could NOT look, so we are not saying anything either way
 *
 * The third is the one that matters. The mirror is pushed by the operator's own
 * machine (home/calendar-drain.ts); when that machine is asleep the mirror goes
 * stale, and a stale window with nothing in it is indistinguishable from a
 * genuinely empty afternoon. Collapsing `unknown` into `clear` would turn a
 * silent card into an implicit "you're free" — the exact class of lie this
 * codebase keeps getting bitten by, where absence of evidence is rendered as
 * evidence of absence.
 */

/** One occupied block, as mirrored from the calendar. */
export type BusyBlock = {
  summary: string | null;
  startsAt: Date;
  /** Exclusive, matching Google's all-day convention. */
  endsAt: Date;
  allDay: boolean;
};

export type ConflictVerdict =
  | { state: "clear" }
  | { state: "conflict"; blocks: BusyBlock[] }
  /** `reason` is operator-facing — it goes on the card verbatim. */
  | { state: "unknown"; reason: string };

/**
 * How old the mirror may be before "nothing found" stops meaning anything.
 *
 * Six hours: the box pushes on every drain pass (minutes apart), so a mirror
 * older than this means the machine has genuinely been away — overnight, or
 * shut. Tighter would cry "can't check" through an ordinary laptop sleep;
 * looser would let a stale day read as a free one.
 */
export const BUSY_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Half-open overlap: [aStart, aEnd) against [bStart, bEnd).
 *
 * Touching is NOT overlapping, and that is the case this exists for — a 14:00
 * to 15:00 booking against an existing 15:00 to 16:00 meeting is back-to-back,
 * not a clash. Using inclusive ends would flag every adjacent pair in a busy
 * day and train the operator to ignore the warning within a week.
 */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Compare a proposed slot against the mirror.
 *
 * `syncedAt` is the freshest row's timestamp, or null when the mirror has never
 * been written. Both "never synced" and "synced too long ago" answer `unknown`:
 * we genuinely do not know, and saying so is the honest card.
 */
export function conflictsFor(input: {
  start: Date;
  end: Date;
  busy: BusyBlock[];
  syncedAt: Date | null;
  now?: Date;
}): ConflictVerdict {
  const now = input.now ?? new Date();

  if (!input.syncedAt) {
    return {
      state: "unknown",
      reason: "I can't see your calendar from here, so I haven't checked for clashes",
    };
  }
  const ageMs = now.getTime() - input.syncedAt.getTime();
  if (ageMs > BUSY_STALE_AFTER_MS) {
    return {
      state: "unknown",
      reason: "your calendar hasn't synced recently, so I couldn't check for clashes",
    };
  }

  const hits = input.busy.filter((b) => overlaps(input.start, input.end, b.startsAt, b.endsAt));
  if (hits.length === 0) return { state: "clear" };

  // Earliest first: the thing you run into soonest is the thing you want named.
  hits.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { state: "conflict", blocks: hits };
}

/**
 * The warning line for an approval card, or null when there is nothing to say.
 *
 * Returns null for `clear` deliberately: a card that announces the absence of a
 * problem on every proposal is noise, and noise is what stops warnings being
 * read. `unknown` DOES speak, because there the silence would be the lie.
 */
export function conflictLine(
  verdict: ConflictVerdict,
  formatTime: (d: Date) => string,
): string | null {
  if (verdict.state === "clear") return null;
  if (verdict.state === "unknown") return `🈳 ${verdict.reason}.`;

  const named = verdict.blocks
    .slice(0, 3)
    .map((b) => {
      const what = b.summary?.trim() || "something unnamed";
      return b.allDay ? `“${what}” (all day)` : `“${what}” ${formatTime(b.startsAt)}`;
    })
    .join(", ");
  const more = verdict.blocks.length > 3 ? ` +${verdict.blocks.length - 3} more` : "";
  return `⚠️ Clashes with ${named}${more}.`;
}
