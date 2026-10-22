/**
 * Stale is gone — design reset rule 11 (docs/development/design-reset-2026-10.md).
 *
 * On 2026-10-21 the owner's bell read a red "9+" over a partner application
 * 19 days old, a builder nudge from 8 days and a feedback summary from 28
 * that read "84 feedback items need you (stalled + check live)". This locks
 * down the three fixes:
 *
 *   1. an alert past its type's window folds into "Earlier" and is not
 *      counted — unless it is urgent, which stays while it is open;
 *   2. the bell leaves out new-feedback notices (they are work, listed on
 *      Home and /feedback);
 *   3. the feedback summary is one plain sentence.
 *
 * Run: npx tsx scripts/test/alert-relevance.ts
 */
import assert from "node:assert/strict";
import {
  bellAlerts,
  isAlertCurrent,
  splitAlertsByRelevance,
  splitBell,
} from "@/lib/alerts/relevance";
import { ALERT_FRESH_DAYS, alertFreshDays } from "@/config/alert-types";
import { needsYouDescription, needsYouTitle } from "@/lib/feedback/needs-you-words";

const DAY = 86_400_000;
const now = Date.parse("2026-10-21T08:00:00Z");
const ago = (days: number) => new Date(now - days * DAY).toISOString();

// 1. Age folds a non-urgent alert; urgency keeps it.
assert.equal(
  isAlertCurrent({ type: "studio_request", severity: "info", createdAt: ago(1) }, now),
  true,
);
assert.equal(
  isAlertCurrent({ type: "studio_request", severity: "info", createdAt: ago(19) }, now),
  false,
  "a partner application from 19 days ago is not news",
);
assert.equal(
  isAlertCurrent({ type: "runner_version_stale", severity: "warning", createdAt: ago(8) }, now),
  false,
  "an 8-day-old nudge folds",
);
assert.equal(
  isAlertCurrent({ type: "project_repo_missing", severity: "urgent", createdAt: ago(28) }, now),
  true,
  "broken is broken however old",
);
// Per-type windows, and unregistered types get the default.
assert.equal(alertFreshDays("runner_stall"), 1);
assert.equal(alertFreshDays("fix_live"), 3);
assert.equal(alertFreshDays("no_such_type"), ALERT_FRESH_DAYS);
assert.equal(
  isAlertCurrent({ type: "runner_stall", severity: "warning", createdAt: ago(2) }, now),
  false,
);
assert.equal(isAlertCurrent({ type: "x", severity: "info", createdAt: "not a date" }, now), false);

// 2. The bell: new feedback out; the rest split, order kept.
const rows = [
  { id: "1", type: "new_feedback", severity: "info", createdAt: ago(0) },
  { id: "2", type: "studio_request", severity: "info", createdAt: ago(0.5) },
  { id: "3", type: "feedback_needs_you", severity: "warning", createdAt: ago(28) },
  { id: "4", type: "project_repo_missing", severity: "urgent", createdAt: ago(28) },
  { id: "5", type: "runner_version_stale", severity: "warning", createdAt: ago(8) },
];
const bell = bellAlerts(rows, now);
assert.deepEqual(
  bell.current.map((r) => r.id),
  ["2", "4"],
  "the count is what still needs you",
);
assert.deepEqual(
  bell.earlier.map((r) => r.id),
  ["3", "5"],
);
assert.deepEqual(
  splitAlertsByRelevance(rows, now).current.map((r) => r.id),
  ["1", "2", "4"],
  "the plain split keeps every type",
);

// The client splits by the server's flag, the same way.
const flagged = rows.map((r) => ({ ...r, earlier: !isAlertCurrent(r, now) }));
assert.deepEqual(
  splitBell(flagged).current.map((r) => r.id),
  bell.current.map((r) => r.id),
);
assert.deepEqual(
  splitBell(flagged).earlier.map((r) => r.id),
  bell.earlier.map((r) => r.id),
);

// 3. Words a person would say.
assert.equal(needsYouTitle(3, 0), "3 feedback fixes stopped and need you");
assert.equal(needsYouTitle(1, 0), "1 feedback fix stopped and needs you");
assert.equal(needsYouTitle(0, 2), "2 feedback fixes are live for you to check");
assert.equal(needsYouTitle(0, 1), "1 feedback fix is live for you to check");
assert.equal(needsYouTitle(82, 2), "82 feedback fixes stopped, and 2 are live for you to check");
for (const [a, b] of [
  [3, 0],
  [0, 2],
  [82, 2],
] as const) {
  const words = `${needsYouTitle(a, b)} ${needsYouDescription(a, b)}`;
  assert.doesNotMatch(words, /\(|\+|stalled|check live|agent|builder/i, words);
}

console.log("✓ alert-relevance: stale alerts fold into Earlier, the bell counts what needs you");
