// Pins what reaches the operator's weekly event digest.
//
// WHY IT EARNS A TEST
// Every suggestion is an interruption with a button on it. The failure that
// matters is not missing a good event — it is sending a message the operator
// learns to swipe past, because after that the good ones are missed too, and
// silently.
//
// The specific ways that happens, each pinned below:
//
//   A GUESSED DATE. The very first search run while building this returned a
//   Zurich meetup dated September 2025 as its top hit. Listings pages say
//   "upcoming" about anything. A candidate whose date cannot be read must be
//   DROPPED, never defaulted to "soon" — a suggestion for an event that already
//   happened teaches the operator the whole feed is junk.
//
//   A DUPLICATE. Listings spell one evening a dozen ways. Comparing raw titles
//   dedupes almost nothing, and the same meetup three times reads as spam.
//
//   A REJECTED THING RETURNING. The operator says no once; the queue is the
//   memory. Re-proposing is how a learning loop proves it isn't one.
import {
  resolveCandidateTimes,
  dedupeKey,
  screenCandidates,
  type EventCandidate,
} from "@/lib/events/candidate";

const NOW = new Date("2026-09-17T10:00:00Z");
const base = (over: Partial<EventCandidate> = {}): EventCandidate => ({
  title: "Zurich AI Meetup",
  startsAt: "2026-09-24T18:00:00+02:00",
  category: "meetup",
  rationale: "small rooms",
  ...over,
});
const screen = (candidates: EventCandidate[], seen: string[] = [], max = 6) =>
  screenCandidates({ candidates, now: NOW, horizonDays: 21, seenKeys: new Set(seen), max });

let pass = 0;
const cases: Array<[string, boolean]> = [];
const check = (name: string, cond: boolean) => {
  cases.push([name, cond]);
  if (cond) pass++;
};

// ── Time resolution: unknown is a drop, never a guess ───────────────────────
check("a timed event resolves", resolveCandidateTimes(base())?.allDay === false);
check(
  "start with no end gets 2h (under-stating length lets clashes through)",
  resolveCandidateTimes({ ...base(), endsAt: undefined })?.end.toISOString() ===
    "2026-09-24T18:00:00.000Z",
);
check(
  "a bare day is all-day with an exclusive end",
  (() => {
    const t = resolveCandidateTimes(base({ startsAt: "2026-09-26", endsAt: undefined }));
    return t?.allDay === true && t.end.toISOString() === "2026-09-27T00:00:00.000Z";
  })(),
);
check("no date at all ⇒ null", resolveCandidateTimes(base({ startsAt: undefined })) === null);
check(
  "unparseable date ⇒ null",
  resolveCandidateTimes(base({ startsAt: "next Thursday" })) === null,
);
check("empty date ⇒ null", resolveCandidateTimes(base({ startsAt: "   " })) === null);

// ── Screening ───────────────────────────────────────────────────────────────
check("a good candidate survives", screen([base()]).length === 1);
check(
  "an undated candidate is dropped, not guessed",
  screen([base({ startsAt: undefined })]).length === 0,
);
check(
  "THE 2025 CASE: a listing from last year is dropped",
  screen([base({ startsAt: "2025-09-20T21:30:00+02:00" })]).length === 0,
);
check(
  "something past the horizon is dropped",
  screen([base({ startsAt: "2026-12-01T18:00:00Z" })]).length === 0,
);
check(
  "an event running RIGHT NOW still counts as live",
  screen([base({ startsAt: "2026-09-17T09:00:00Z", endsAt: "2026-09-17T23:00:00Z" })]).length === 1,
);
check(
  "an event that ended an hour ago is dropped",
  screen([base({ startsAt: "2026-09-17T07:00:00Z", endsAt: "2026-09-17T08:00:00Z" })]).length === 0,
);
check("a titleless candidate is dropped", screen([base({ title: "  " })]).length === 0);

// ── Dedupe ──────────────────────────────────────────────────────────────────
check(
  "issue numbers and the city don't make it a different event",
  dedupeKey({ title: "ZURICH AI Meetup #14" }) === dedupeKey({ title: "Zurich AI Meetup" }),
);
check(
  "tracking params don't make it a different event",
  dedupeKey({ title: "X", url: "https://www.meetup.com/a?utm=1" }) ===
    dedupeKey({ title: "X", url: "https://meetup.com/a/b?ref=2" }),
);
check(
  "genuinely different events keep different keys",
  dedupeKey({ title: "Rust Meetup" }) !== dedupeKey({ title: "Rust Conference" }),
);
check(
  "the same evening spelled two ways appears once",
  screen([base(), base({ title: "ZURICH AI MEETUP #14" })]).length === 1,
);

// ── Learning: a no is remembered ────────────────────────────────────────────
check(
  "something already proposed is not proposed again",
  screen([base()], [dedupeKey({ title: "Zurich AI Meetup" })]).length === 0,
);
check(
  "a rejected event stays rejected even when spelled differently",
  screen([base({ title: "Zurich AI Meetup #15" })], [dedupeKey({ title: "Zurich AI Meetup" })])
    .length === 0,
);

// ── Order and cap ───────────────────────────────────────────────────────────
check(
  "soonest first — the decision you owe first comes first",
  (() => {
    const out = screen([
      base({ title: "Later", startsAt: "2026-10-01T18:00:00Z" }),
      base({ title: "Sooner", startsAt: "2026-09-19T18:00:00Z" }),
    ]);
    return out[0]?.title === "Sooner";
  })(),
);
check(
  "the cap holds — the digest is a handful, not a feed",
  screen(
    Array.from({ length: 30 }, (_, i) =>
      base({
        title: `Thing ${i}`,
        startsAt: `2026-09-${String(18 + (i % 5)).padStart(2, "0")}T18:00:00Z`,
      }),
    ),
    [],
    6,
  ).length === 6,
);

for (const [name, ok] of cases) console.log(`${ok ? "✓" : "✗"} ${name}`);
console.log(`\n${pass}/${cases.length} passed`);
if (pass !== cases.length) process.exit(1);
