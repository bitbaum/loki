import assert from "node:assert/strict";
import {
  countThreadStates,
  deriveThreadState,
  groupThreadsByProject,
  NO_PROJECT_GROUP,
  RUNNING_STALE_MS,
  sortThreads,
  threadStateSummary,
} from "../../src/lib/loki/thread-state";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function thread(
  id: string,
  over: Partial<Parameters<typeof deriveThreadState>[0]> & {
    updatedAt?: string;
    pinnedAt?: string | null;
    projectKeys?: string[];
  } = {},
) {
  return {
    id,
    lastRole: "assistant",
    lastKind: "chat",
    lastAt: ago(10),
    lastOk: null,
    lastOutcome: null,
    lastNeedsProject: null,
    lastReadAt: null,
    updatedAt: ago(10),
    pinnedAt: null,
    projectKeys: ["loki"],
    ...over,
  };
}

// A command waiting on a project pick is the clearest "needs you".
assert.equal(
  deriveThreadState(thread("a", { lastKind: "command", lastNeedsProject: true }), NOW).kind,
  "needs-you",
);
// A dispatch that could not start needs you; one that started is running.
assert.equal(
  deriveThreadState(thread("b", { lastKind: "dispatch", lastOk: false }), NOW).kind,
  "needs-you",
);
assert.equal(
  deriveThreadState(thread("c", { lastKind: "dispatch", lastOk: true }), NOW).kind,
  "running",
);
// A dispatch with no outcome for six hours is not "running" any more.
const stale = thread("d", {
  lastKind: "dispatch",
  lastOk: true,
  lastAt: new Date(NOW - RUNNING_STALE_MS - 1).toISOString(),
});
assert.notEqual(deriveThreadState(stale, NOW).kind, "running");
// A finished run: "done" until read, then quiet; a failed one needs you.
const finished = thread("e", { lastKind: "outcome", lastOutcome: "success" });
assert.equal(deriveThreadState(finished, NOW).kind, "done");
assert.equal(deriveThreadState({ ...finished, lastReadAt: ago(1) }, NOW).kind, "quiet");
assert.equal(
  deriveThreadState(thread("f", { lastKind: "outcome", lastOutcome: "partial" }), NOW).kind,
  "done",
);
assert.equal(
  deriveThreadState(thread("g", { lastKind: "outcome", lastOutcome: "timeout" }), NOW).kind,
  "needs-you",
);
// A plain answer that arrived after the last read is unread; after a read, quiet.
assert.equal(deriveThreadState(thread("h"), NOW).kind, "unread");
assert.equal(deriveThreadState(thread("i", { lastReadAt: ago(5) }), NOW).kind, "quiet");
// The person's own last message never asks anything of them.
assert.equal(deriveThreadState(thread("j", { lastRole: "user" }), NOW).kind, "quiet");
// Labels are words, never the state code.
for (const t of [thread("a", { lastKind: "command", lastNeedsProject: true }), finished]) {
  assert.ok(!/needs-you|unread/.test(deriveThreadState(t, NOW).label));
}

// Sort: pinned, then needs-you, running, came-back, quiet — recency within.
const sorted = sortThreads(
  [
    thread("quiet-new", { lastRole: "user", updatedAt: ago(1) }),
    thread("done", { lastKind: "outcome", lastOutcome: "success", updatedAt: ago(30) }),
    thread("running", { lastKind: "dispatch", lastOk: true, updatedAt: ago(20) }),
    thread("needs", { lastKind: "command", lastNeedsProject: true, updatedAt: ago(60) }),
    thread("pinned-quiet", { lastRole: "user", updatedAt: ago(90), pinnedAt: ago(90) }),
  ],
  NOW,
).map((t) => t.id);
assert.deepEqual(sorted, ["pinned-quiet", "needs", "running", "done", "quiet-new"]);

// Counts and the one-line summary.
const counts = countThreadStates(
  [
    thread("1", { lastKind: "command", lastNeedsProject: true }),
    thread("2", { lastKind: "dispatch", lastOk: true }),
    thread("3", { lastKind: "dispatch", lastOk: true }),
    thread("4", { lastKind: "outcome", lastOutcome: "success" }),
    thread("5", { lastRole: "user" }),
  ],
  NOW,
);
assert.deepEqual(counts, { needsYou: 1, running: 2, done: 1 });
assert.equal(threadStateSummary(counts), "1 needs you · 2 running · 1 came back");
assert.equal(threadStateSummary({ needsYou: 2, running: 0, done: 0 }), "2 need you");
assert.equal(
  threadStateSummary({ needsYou: 0, running: 0, done: 0 }),
  "",
  "nothing to say → no line",
);

// Groups: urgent project first, no-project last, each group sorted.
const groups = groupThreadsByProject(
  [
    thread("k1", { projectKeys: ["kivvi"], lastRole: "user", updatedAt: ago(1) }),
    thread("l1", {
      projectKeys: ["loki"],
      lastKind: "command",
      lastNeedsProject: true,
      updatedAt: ago(200),
    }),
    thread("n1", { projectKeys: [], lastKind: "dispatch", lastOk: true, updatedAt: ago(2) }),
    thread("l2", { projectKeys: ["loki"], lastRole: "user", updatedAt: ago(3) }),
  ],
  NOW,
);
assert.deepEqual(
  groups.map((g) => g.project),
  ["loki", "kivvi", NO_PROJECT_GROUP],
);
assert.deepEqual(
  groups[0]!.threads.map((t) => t.id),
  ["l1", "l2"],
);
assert.equal(groups[0]!.counts.needsYou, 1);

console.log("✓ loki thread state");
