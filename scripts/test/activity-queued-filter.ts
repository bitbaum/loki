/**
 * The biggest number on the Activity page was the one you could not open.
 *
 * Prod, 2026-09-20: the KPI row read "9 Needs you · 1 Shipped · 0 Running ·
 * 49 Queued". Four of those were links that filter the list below. "Queued"
 * was a <span> — its only explanation a `title` tooltip, which a touch device
 * never shows. So the largest figure on the page, and the one that most needs
 * investigating (49 waiting while nothing runs), was a wall.
 *
 * The rule that decides it now lives in ONE place, `eventIsQueued`, used by
 * the hero's count, the tab's tally and the filtered list alike. Two copies
 * would be worse than none: a count and a list that disagree teach people to
 * trust neither.
 *
 * Run: npx tsx scripts/test/activity-queued-filter.ts
 */
import {
  eventIsQueued,
  filterActivityEvents,
  tallyActivityEvents,
  ACTIVITY_FILTERS,
  type ActivityEvent,
} from "@/lib/activity-events";
import { summarizeActivity } from "@/lib/activity-summary";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const E = (over: Partial<ActivityEvent>): ActivityEvent =>
  ({
    id: Math.random().toString(36).slice(2),
    occurredAt: "2026-09-20T12:00:00.000Z",
    projectKey: "loki",
    agentLabel: "Claude Code",
    intentLabel: "custom",
    intentId: "custom",
    status: "neutral",
    outcome: "dispatched",
    outcomeLabel: "Dispatched",
    durationLabel: null,
    durationMs: null,
    ask: null,
    done: null,
    next: null,
    error: null,
    verification: null,
    isLocalChat: false,
    runId: null,
    promptId: "p1",
    ...over,
  }) as ActivityEvent;

console.log("activity-queued-filter:");

check("queued is a real filter, not just a number", () => {
  assert(ACTIVITY_FILTERS.includes("queued"), "filter must exist");
});

check("a dispatch with no run counts as queued", () => {
  assert(eventIsQueued(E({})), "plain dispatch");
});

check("a local chat is never queued work", () => {
  // It is a conversation, not a dispatch waiting on a builder.
  assert(!eventIsQueued(E({ isLocalChat: true })), "local chat excluded");
});

check("anything needing attention outranks queued", () => {
  // Matches the order the summary already used: a dispatch that never reached
  // an agent is reported as needing you, not as patiently waiting.
  assert(!eventIsQueued(E({ outcome: "unconfirmed" })), "unconfirmed is attention");
  assert(!eventIsQueued(E({ outcome: "error" })), "error is attention");
});

check("finished work is not queued", () => {
  assert(!eventIsQueued(E({ outcome: "success" })), "success");
  assert(!eventIsQueued(E({ outcome: "running" })), "running");
});

check("THE INVARIANT: the count, the tally and the list agree", () => {
  // This is the whole point. If these three ever diverge, the page is lying
  // to someone — and that is exactly the shape of bug this fix removes.
  const events = [
    E({}),
    E({}),
    E({ isLocalChat: true }),
    E({ outcome: "success" }),
    E({ outcome: "running" }),
    E({ outcome: "error" }),
  ];
  const summary = summarizeActivity(events);
  const tallies = tallyActivityEvents(events);
  const listed = filterActivityEvents(events, "queued");
  assert(summary.queued === 2, `hero count: ${summary.queued}`);
  assert(tallies.queued === 2, `tab tally: ${tallies.queued}`);
  assert(listed.length === 2, `list length: ${listed.length}`);
  assert(listed.every(eventIsQueued), "every listed row is queued");
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
