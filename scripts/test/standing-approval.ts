// Pins the rails on standing approvals — the rule that lets Loki act without
// asking.
//
// Why it earns a test: this is the only code in the app that can turn a
// proposal into a real-world effect with no human in the loop. Every other
// guard in the action queue fails safe by doing nothing; this one fails by
// DOING something. The dangerous direction is a false `auto: true`, so the
// three rails are asserted from the side that hurts:
//
//   1. an ineligible type can never be authorised, even by a stored preference
//      that names it — a database row must not be able to widen the set;
//   2. an event with guests goes back to the queue, because guests mean
//      invitations, which are outbound and not undoable;
//   3. "we don't know when" is not "yes" — an unresolvable or past slot queues.
//
// The negative cases are the point. A test that only proved the happy path
// would pass just as happily on a version that returned `{auto:true}` for
// everything.
import {
  STANDING_APPROVAL_ELIGIBLE,
  isStandingApprovalEligible,
  sanitizeStandingApprovals,
  standingApprovalVerdict,
} from "@/lib/actions/standing-approval";
import { ACTION_TYPE } from "@/lib/constants/statuses";

const NOW = Date.parse("2026-09-17T10:00:00Z");
const SOON = { eventStart: "2026-09-19T14:00:00+02:00", eventEnd: "2026-09-19T15:00:00+02:00" };
const ALL = [ACTION_TYPE.CREATE_EVENT, ACTION_TYPE.CREATE_COMMITMENT];

let pass = 0;
const cases: Array<[string, boolean]> = [];
const check = (name: string, cond: boolean) => {
  cases.push([name, cond]);
  if (cond) pass++;
};

const auto = (args: Parameters<typeof standingApprovalVerdict>[0]) =>
  standingApprovalVerdict({ now: NOW, ...args }).auto;

// ── RAIL 1: eligibility is code, not data ───────────────────────────────────
check(
  "eligible set is exactly create_event + create_commitment",
  STANDING_APPROVAL_ELIGIBLE.length === 2 &&
    STANDING_APPROVAL_ELIGIBLE.includes(ACTION_TYPE.CREATE_EVENT) &&
    STANDING_APPROVAL_ELIGIBLE.includes(ACTION_TYPE.CREATE_COMMITMENT),
);
for (const type of [
  ACTION_TYPE.SEND_EMAIL,
  ACTION_TYPE.SEND_MESSAGE,
  ACTION_TYPE.DISPATCH_PROMPT,
  ACTION_TYPE.IMPORT_PERSON,
  ACTION_TYPE.ENRICH_PERSON,
  ACTION_TYPE.MERGE_PEOPLE,
  ACTION_TYPE.FOLLOW_UP,
  ACTION_TYPE.OTHER,
] as const) {
  check(`${type} is NOT eligible`, !isStandingApprovalEligible(type));
  // The nasty one: a preference row that explicitly names an outbound type.
  check(
    `${type} is refused even when the stored preference names it`,
    !auto({ type, payload: { to: "someone@example.com", body: "hi" }, standingApprovals: [type] }),
  );
}
check(
  "sanitize drops ineligible and unknown values",
  JSON.stringify(
    sanitizeStandingApprovals(["send_email", "create_event", "nonsense", "merge_people"]),
  ) === JSON.stringify([ACTION_TYPE.CREATE_EVENT]),
);
check("sanitize of null is empty", sanitizeStandingApprovals(null).length === 0);
check(
  "sanitize dedupes repeats",
  sanitizeStandingApprovals(["create_event", "create_event"]).length === 1,
);

// ── The rule has to actually work, or it is just a stricter queue ───────────
check(
  "event with a real slot and a rule ⇒ auto",
  auto({ type: ACTION_TYPE.CREATE_EVENT, payload: SOON, standingApprovals: ALL }),
);
check(
  "all-day event ⇒ auto",
  auto({
    type: ACTION_TYPE.CREATE_EVENT,
    payload: { eventDate: "2026-09-20", allDay: true },
    standingApprovals: ALL,
  }),
);
check(
  "commitment with a rule ⇒ auto",
  auto({
    type: ACTION_TYPE.CREATE_COMMITMENT,
    payload: { commitment: "call the landlord" },
    standingApprovals: ALL,
  }),
);
check(
  "no rule set ⇒ queues (this is the default for a user who never opted in)",
  !auto({ type: ACTION_TYPE.CREATE_EVENT, payload: SOON, standingApprovals: [] }),
);
check(
  "a rule for the OTHER eligible type does not cover this one",
  !auto({
    type: ACTION_TYPE.CREATE_EVENT,
    payload: SOON,
    standingApprovals: [ACTION_TYPE.CREATE_COMMITMENT],
  }),
);

// ── RAIL 2: guests mean invitations, which are outbound ─────────────────────
for (const [name, payload] of [
  ["attendees array", { ...SOON, attendees: ["ana@example.com"] }],
  ["attendees string", { ...SOON, attendees: "ana@example.com" }],
  ["guests field", { ...SOON, guests: ["ana@example.com"] }],
  ["invitees field", { ...SOON, invitees: ["ana@example.com"] }],
  ["eventAttendees field", { ...SOON, eventAttendees: ["ana@example.com"] }],
] as const) {
  check(
    `event with ${name} ⇒ queues despite the rule`,
    !auto({ type: ACTION_TYPE.CREATE_EVENT, payload, standingApprovals: ALL }),
  );
}
check(
  "an EMPTY attendees array is not guests",
  auto({
    type: ACTION_TYPE.CREATE_EVENT,
    payload: { ...SOON, attendees: [] },
    standingApprovals: ALL,
  }),
);
check(
  "a blank attendees string is not guests",
  auto({
    type: ACTION_TYPE.CREATE_EVENT,
    payload: { ...SOON, attendees: "  " },
    standingApprovals: ALL,
  }),
);

// ── RAIL 3: unknown is not yes ──────────────────────────────────────────────
check(
  "event with no resolvable time ⇒ queues",
  !auto({
    type: ACTION_TYPE.CREATE_EVENT,
    payload: { body: "sometime next week probably" },
    standingApprovals: ALL,
  }),
);
check(
  "event with an unparseable time ⇒ queues",
  !auto({
    type: ACTION_TYPE.CREATE_EVENT,
    payload: { eventStart: "next tuesday" },
    standingApprovals: ALL,
  }),
);
check(
  "null payload ⇒ queues",
  !auto({ type: ACTION_TYPE.CREATE_EVENT, payload: null, standingApprovals: ALL }),
);
check(
  "event whose slot already passed ⇒ queues (never books into the past)",
  !auto({
    type: ACTION_TYPE.CREATE_EVENT,
    payload: { eventStart: "2026-09-16T09:00:00Z", eventEnd: "2026-09-16T10:00:00Z" },
    standingApprovals: ALL,
  }),
);
check(
  "a declined event says WHY, so the rule never looks broken",
  (() => {
    const v = standingApprovalVerdict({
      type: ACTION_TYPE.CREATE_EVENT,
      payload: { ...SOON, attendees: ["ana@example.com"] },
      standingApprovals: ALL,
      now: NOW,
    });
    return !v.auto && v.reason.includes("guests");
  })(),
);

for (const [name, ok] of cases) console.log(`${ok ? "✓" : "✗"} ${name}`);
console.log(`\n${pass}/${cases.length} passed`);
if (pass !== cases.length) process.exit(1);
