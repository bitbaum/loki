/**
 * What each terminal tab says its session is doing — working, needs you,
 * finished, open — and which changes are worth telling someone who is looking
 * at another session. Same order of precedence as Control's presenter, so the
 * two surfaces can never disagree about one session.
 *
 * Run: npx tsx scripts/test/terminal-session-status.ts
 */
import type { FastProjectState } from "@/lib/control-fast-state";
import { orderSessions, isNewsworthy, sessionStatusOf } from "@/lib/terminal-session-status";

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

const base: FastProjectState = {
  tab: "substrata",
  agentRunning: true,
  tabOpen: true,
  activeAgents: ["claude"],
  session: null,
  currentPrompt: null,
  readyAt: null,
  lockAt: null,
  closingAt: null,
  closedAt: null,
};
const prompt = { key: "k", label: "Fix the build", startedAt: 1 };
const blocked = {
  status: "blocked",
  done: "",
  next: "",
  tests: "",
  todos: "",
  health: "awaiting user",
  blockReason: "Which domain?",
} as unknown as FastProjectState["session"];

check("no report yet is no status, never a guess", () => {
  assert(sessionStatusOf(null) === null, "expected null");
});
check("a turn in progress is working", () => {
  assert(sessionStatusOf({ ...base, currentPrompt: prompt }) === "working", "expected working");
});
check("a handoff blocked on the person is needs-you", () => {
  assert(sessionStatusOf({ ...base, session: blocked }) === "needs-you", "expected needs-you");
});
check("working outranks a stale blocked handoff, as in Control", () => {
  assert(
    sessionStatusOf({ ...base, session: blocked, currentPrompt: prompt }) === "working",
    "expected working",
  );
});
check("a finished turn with nothing running is done", () => {
  assert(sessionStatusOf({ ...base, readyAt: 100 }) === "done", "expected done");
});
check("an open session with no signals is idle", () => {
  assert(sessionStatusOf(base) === "idle", "expected idle");
});

check("finishing after work is news; starting work is not", () => {
  assert(isNewsworthy("working", "done"), "working → done");
  assert(!isNewsworthy("idle", "working"), "idle → working");
  assert(!isNewsworthy("done", "done"), "no change");
});
check("starting to wait on the person is news", () => {
  assert(isNewsworthy("working", "needs-you"), "working → needs-you");
  assert(isNewsworthy("idle", "needs-you"), "idle → needs-you");
});
check("the first report of a session is never news", () => {
  assert(!isNewsworthy(undefined, "needs-you"), "first sight should be quiet");
});

check("the session list leads with what needs the person and folds the quiet ones", () => {
  const tabs = [
    { id: "loki-2", status: "idle" as const },
    { id: "loki-3", status: null },
    { id: "kivvi", status: "needs-you" as const },
    { id: "loki-4", status: "idle" as const },
    { id: "bias", status: "working" as const },
    { id: "loki-5", status: "idle" as const },
    { id: "solon", status: "done" as const },
    { id: "loki-6", status: "idle" as const },
  ];
  const { first, quiet } = orderSessions(tabs, "loki-4");
  assert(
    first.map((t) => t.id).join(",") === "kivvi,bias,solon,loki-4",
    `needs-you, working, finished, then the one in use: got ${first.map((t) => t.id)}`,
  );
  assert(quiet.length === 4 && !quiet.some((t) => t.id === "loki-4"), "the rest wait");
});
check("a few quiet sessions are simply listed", () => {
  const { first, quiet } = orderSessions(
    [
      { id: "a", status: "idle" as const },
      { id: "b", status: "needs-you" as const },
    ],
    null,
  );
  assert(first.map((t) => t.id).join(",") === "b,a" && quiet.length === 0, "nothing folded");
});

if (failures) {
  console.log(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passing");
