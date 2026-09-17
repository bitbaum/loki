// Pins the conflict warning on approval cards.
//
// WHY IT EARNS A TEST
// This warning has exactly two ways to be worse than useless, and they pull in
// opposite directions:
//
//   FALSE POSITIVE — flags a clash that isn't one. Back-to-back meetings are
//   the common case in a real diary (14:00–15:00 then 15:00–16:00), and a
//   warning that fires on every adjacent pair is one the operator stops reading
//   inside a week. Then the real clash goes past unnoticed.
//
//   FALSE NEGATIVE — stays silent when it could not actually check. The mirror
//   is pushed by the operator's own machine; when that machine is asleep the
//   window goes stale, and a stale-and-empty window looks exactly like a free
//   afternoon. Saying nothing there is heard as "you're free", which is a lie
//   the card would be telling on the app's behalf.
//
// So `unknown` is asserted as carefully as `conflict`. The rule this file
// defends: absence of evidence is never rendered as evidence of absence.
import {
  overlaps,
  conflictsFor,
  conflictLine,
  BUSY_STALE_AFTER_MS,
  type BusyBlock,
} from "@/lib/calendar/busy";

const NOW = new Date("2026-09-24T09:00:00Z");
const FRESH = new Date(NOW.getTime() - 60 * 1000);
const d = (iso: string) => new Date(iso);
const block = (summary: string | null, from: string, to: string, allDay = false): BusyBlock => ({
  summary,
  startsAt: d(from),
  endsAt: d(to),
  allDay,
});

// The real collision from 2026-09-17: a proposal at 14:30–15:30 on top of an
// existing 15:00–16:00 meeting, which shipped with no warning at all.
const SIMON = block("Gespräch Simon Binder", "2026-09-24T13:00:00Z", "2026-09-24T14:00:00Z");
const PROPOSED_START = d("2026-09-24T12:30:00Z");
const PROPOSED_END = d("2026-09-24T13:30:00Z");

let pass = 0;
const cases: Array<[string, boolean]> = [];
const check = (name: string, cond: boolean) => {
  cases.push([name, cond]);
  if (cond) pass++;
};

const verdict = (
  busy: BusyBlock[],
  syncedAt: Date | null,
  start = PROPOSED_START,
  end = PROPOSED_END,
) => conflictsFor({ start, end, busy, syncedAt, now: NOW });

// ── Half-open overlap ───────────────────────────────────────────────────────
check(
  "the real 2026-09-17 collision is detected",
  overlaps(PROPOSED_START, PROPOSED_END, SIMON.startsAt, SIMON.endsAt),
);
check(
  "back-to-back is NOT a clash (this is the false-positive guard)",
  !overlaps(
    d("2026-09-24T14:00:00Z"),
    d("2026-09-24T15:00:00Z"),
    d("2026-09-24T15:00:00Z"),
    d("2026-09-24T16:00:00Z"),
  ),
);
check(
  "touching the other way is NOT a clash either",
  !overlaps(
    d("2026-09-24T15:00:00Z"),
    d("2026-09-24T16:00:00Z"),
    d("2026-09-24T14:00:00Z"),
    d("2026-09-24T15:00:00Z"),
  ),
);
check(
  "fully contained IS a clash",
  overlaps(
    d("2026-09-24T14:15:00Z"),
    d("2026-09-24T14:30:00Z"),
    d("2026-09-24T14:00:00Z"),
    d("2026-09-24T15:00:00Z"),
  ),
);
check(
  "fully containing IS a clash",
  overlaps(
    d("2026-09-24T13:00:00Z"),
    d("2026-09-24T18:00:00Z"),
    d("2026-09-24T14:00:00Z"),
    d("2026-09-24T15:00:00Z"),
  ),
);

// ── clear / conflict ────────────────────────────────────────────────────────
check("empty fresh mirror ⇒ clear", verdict([], FRESH).state === "clear");
check(
  "non-overlapping day ⇒ clear",
  verdict([block("Standup", "2026-09-24T07:00:00Z", "2026-09-24T07:15:00Z")], FRESH).state ===
    "clear",
);
check("overlapping block ⇒ conflict", verdict([SIMON], FRESH).state === "conflict");
check(
  "the conflicting block is named back",
  (() => {
    const v = verdict([SIMON], FRESH);
    return v.state === "conflict" && v.blocks[0].summary === "Gespräch Simon Binder";
  })(),
);
check(
  "conflicts come back earliest-first",
  (() => {
    const later = block("Later", "2026-09-24T13:20:00Z", "2026-09-24T14:30:00Z");
    const v = verdict([later, SIMON], FRESH);
    return v.state === "conflict" && v.blocks[0].summary === "Gespräch Simon Binder";
  })(),
);
check(
  "an all-day event clashes with a timed proposal inside it",
  verdict([block("Autechre", "2026-09-24T00:00:00Z", "2026-09-25T00:00:00Z", true)], FRESH)
    .state === "conflict",
);

// ── unknown — the direction that must never collapse into "clear" ──────────
check("never synced ⇒ unknown, NOT clear", verdict([], null).state === "unknown");
check(
  "stale mirror ⇒ unknown, NOT clear",
  verdict([], new Date(NOW.getTime() - BUSY_STALE_AFTER_MS - 1000)).state === "unknown",
);
check(
  "just inside the freshness window ⇒ still answers clear",
  verdict([], new Date(NOW.getTime() - BUSY_STALE_AFTER_MS + 1000)).state === "clear",
);
check(
  "unknown explains itself to the operator",
  (() => {
    const v = verdict([], null);
    return v.state === "unknown" && v.reason.length > 10;
  })(),
);

// ── The card line ───────────────────────────────────────────────────────────
const hm = (x: Date) =>
  x.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
check(
  "clear says nothing (no noise on a good proposal)",
  conflictLine(verdict([], FRESH), hm) === null,
);
check(
  "conflict line names the thing and warns",
  (() => {
    const line = conflictLine(verdict([SIMON], FRESH), hm) ?? "";
    return line.includes("⚠️") && line.includes("Gespräch Simon Binder");
  })(),
);
check(
  "unknown line DOES speak (silence would read as 'you're free')",
  (conflictLine(verdict([], null), hm) ?? "").includes("couldn't") ||
    (conflictLine(verdict([], null), hm) ?? "").includes("can't"),
);
check(
  "an untitled clash still warns",
  (
    conflictLine(
      verdict([block(null, "2026-09-24T13:00:00Z", "2026-09-24T14:00:00Z")], FRESH),
      hm,
    ) ?? ""
  ).includes("⚠️"),
);
check(
  "many clashes are summarised, not dumped",
  (() => {
    const many = Array.from({ length: 6 }, (_, i) =>
      block(`Thing ${i}`, "2026-09-24T13:00:00Z", "2026-09-24T14:00:00Z"),
    );
    const line = conflictLine(verdict(many, FRESH), hm) ?? "";
    return line.includes("+3 more");
  })(),
);

for (const [name, ok] of cases) console.log(`${ok ? "✓" : "✗"} ${name}`);
console.log(`\n${pass}/${cases.length} passed`);
if (pass !== cases.length) process.exit(1);
