/**
 * The Sessions list's words (lib/session-list): open or not, what an open
 * one is doing, and when an agent last worked on the rest — never the age of
 * a database row ("aoz-housing · offline · 29d ago", owner, 2026-10-19).
 *
 * Run: npx tsx scripts/test/session-list.ts
 */
import assert from "node:assert/strict";
import {
  OPEN_FRESH_MS,
  sessionListRow,
  workingNow,
  type SessionStateRow,
} from "../../src/lib/session-list";

const NOW = Date.parse("2026-10-19T18:00:00Z");
const ago = (ms: number) => new Date(NOW - ms);
const row = (patch: Partial<SessionStateRow>): SessionStateRow => ({
  agentRunning: true,
  tabOpen: true,
  closedAt: null,
  sessionStatus: null,
  sessionBlockReason: null,
  currentPromptKey: null,
  currentPromptLabel: null,
  runtimeObservedAt: ago(60_000),
  sessionUpdatedAt: null,
  currentPromptStartedAt: null,
  updatedAt: ago(60_000),
  ...patch,
});

// Open, and what tapping gives you.
assert.deepEqual(sessionListRow(row({}), NOW), {
  open: true,
  status: "idle",
  line: "Open, nothing running",
});
assert.deepEqual(
  sessionListRow(
    row({ currentPromptKey: "custom", currentPromptLabel: "Fix the contact form" }),
    NOW,
  ),
  { open: true, status: "working", line: "Working on Fix the contact form" },
);
assert.equal(
  sessionListRow(row({ currentPromptKey: "custom", currentPromptLabel: "custom" }), NOW).open &&
    (
      sessionListRow(row({ currentPromptKey: "custom", currentPromptLabel: "custom" }), NOW) as {
        line: string;
      }
    ).line,
  "Working",
  "a bare prompt key is not shown as a task",
);
assert.deepEqual(sessionListRow(row({ sessionStatus: "blocked" }), NOW), {
  open: true,
  status: "waiting",
  line: "Waiting for you",
});
assert.deepEqual(sessionListRow(row({ sessionBlockReason: "awaiting_user" }), NOW), {
  open: true,
  status: "waiting",
  line: "Waiting for you",
});
assert.deepEqual(sessionListRow(row({ sessionStatus: "ready" }), NOW), {
  open: true,
  status: "finished",
  line: "Finished — your turn",
});
// A turn in progress outranks a stale "blocked" handoff.
assert.equal(
  (
    sessionListRow(row({ sessionStatus: "blocked", currentPromptKey: "next_best" }), NOW) as {
      status: string;
    }
  ).status,
  "working",
);

// Not open: closed, nothing running, or not seen by the runner lately.
assert.equal(sessionListRow(row({ closedAt: ago(1000) }), NOW).open, false);
assert.equal(sessionListRow(row({ agentRunning: false, tabOpen: false }), NOW).open, false);
assert.equal(
  sessionListRow(row({ runtimeObservedAt: ago(OPEN_FRESH_MS + 1000) }), NOW).open,
  false,
  "a session the runner has not seen for ten minutes is not called open",
);
assert.deepEqual(sessionListRow(null, NOW), { open: false, lastWorkedAt: null });

// "Last worked" is the agent's own handoff or prompt start — not updatedAt,
// which the runner rewrites on every heartbeat.
const closed = sessionListRow(
  row({
    closedAt: ago(1000),
    updatedAt: ago(60_000),
    sessionUpdatedAt: ago(3 * 86_400_000),
    currentPromptStartedAt: ago(5 * 86_400_000),
  }),
  NOW,
);
assert.deepEqual(closed, { open: false, lastWorkedAt: ago(3 * 86_400_000).toISOString() });
assert.deepEqual(
  sessionListRow(row({ closedAt: ago(1000) }), NOW),
  { open: false, lastWorkedAt: null },
  "no agent turn on record: no age at all",
);

console.log("✓ session-list: open in words, the rest by when an agent last worked");

// The top bar's "anything running?": only working sessions, linked to watch.
{
  const item = (name: string, session: ReturnType<typeof sessionListRow>, tab: string | null) => ({
    name,
    tab,
    session,
  });
  const working = { open: true as const, status: "working" as const, line: "Working" };
  const waiting = { open: true as const, status: "waiting" as const, line: "Waiting for you" };
  assert.equal(
    workingNow(
      [item("a", waiting, "a"), item("b", { open: false, lastWorkedAt: null }, null)],
      "/terminal",
    ),
    null,
    "nothing working: nothing drawn (waiting is not working)",
  );
  assert.deepEqual(
    workingNow([item("Loki", working, "loki-tab"), item("b", waiting, "b")], "/terminal"),
    {
      count: 1,
      href: "/terminal?tab=loki-tab",
      label: "1 agent working now — watch it",
    },
  );
  assert.equal(
    workingNow([item("Loki", working, null)], "/terminal")?.href,
    "/terminal?project=Loki",
    "no tab known: the project's session",
  );
  const two = workingNow([item("a", working, "a"), item("b", working, "b")], "/terminal");
  assert.equal(two?.href, "/terminal", "several: the list to pick from");
  assert.equal(two?.label, "2 agents working now — watch them");
  console.log("✓ session-list: the top bar says when agents are working, and links to watch");
}
