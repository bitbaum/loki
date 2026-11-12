/**
 * A message to a busy project waits its turn; only a caller that asks gets a
 * parallel lane.
 *
 * Production, 2026-11-12: a message to orangecat while run 9e3658d9 was open
 * started a second agent in a lane of its own (which then failed) instead of
 * queueing behind the open run. The same message to loki queued. The
 * difference was whether a lane happened to be free, not what the caller
 * meant. These pin the rule and the callers that depend on it.
 *
 * Run: npx tsx scripts/test/busy-placement.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { busyPlacement } from "@/lib/orchestration/busy-placement";
import { ONE_OFF_SESSION_NOTE, promptForOneOff } from "@/lib/orchestration/lane-prompt";

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
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const full = { hasDir: true, hasProjectKey: true };

check("a free project dispatches now, whatever the caller asked", () => {
  for (const whenBusy of [undefined, "queue", "lane"] as const) {
    assert(busyPlacement({ projectBusy: false, whenBusy, ...full }) === "now", `${whenBusy}`);
  }
});

check("a busy project queues by default", () => {
  assert(busyPlacement({ projectBusy: true, whenBusy: undefined, ...full }) === "queue", "default");
  assert(busyPlacement({ projectBusy: true, whenBusy: "queue", ...full }) === "queue", "queue");
});

check("a busy project gives a lane only to a caller that asked", () => {
  assert(busyPlacement({ projectBusy: true, whenBusy: "lane", ...full }) === "lane", "lane");
});

check("a lane needs a checkout to cut a worktree from, else it queues", () => {
  assert(
    busyPlacement({ projectBusy: true, whenBusy: "lane", hasDir: false, hasProjectKey: true }) ===
      "queue",
    "no dir",
  );
  assert(
    busyPlacement({ projectBusy: true, whenBusy: "lane", hasDir: true, hasProjectKey: false }) ===
      "queue",
    "no project",
  );
});

check("the executor forks a lane only through this rule", () => {
  const src = read("src/lib/executor.ts");
  assert(/busyPlacement\(\{/.test(src), "executeInject does not consult busyPlacement");
  assert(
    /\(placement === "lane" \|\| placement === "fresh"\) && payload\.dir && payload\.projectKey\s*\? await planParallelRun\(/.test(
      src,
    ),
    "planParallelRun is reachable without the caller asking for a lane",
  );
  assert(
    (src.match(/planParallelRun\(/g) ?? []).length === 1,
    "a second planParallelRun call bypasses the rule",
  );
});

check("inject-core hands the caller's choice to the executor and adds none of its own", () => {
  const src = read("src/lib/inject-core.ts");
  assert(/whenBusy: params\.whenBusy,/.test(src), "the choice is not passed through");
  assert(!/whenBusy: "lane"/.test(src), "inject-core asks for a lane by itself");
});

check("a message through the API or MCP never asks for a lane", () => {
  for (const rel of [
    "src/app/api/inject/route.ts",
    "src/lib/mcp/services.ts",
    "src/app/api/conversations/[id]/messages/route.ts",
    "src/app/api/control/tab-inject/route.ts",
  ]) {
    assert(!/whenBusy:\s*"lane"/.test(read(rel)), `${rel} forks a lane for a message`);
  }
});

check("every way a feedback fix starts asks for a lane, as Implement does", () => {
  // "Implement all" and the widget's "Build all" (batch-dispatch), and the
  // automatic retry of a stuck Implement (retry-queued), queued behind the
  // project's open run after #1639 while single-item Implement got a lane.
  for (const rel of ["src/lib/feedback/batch-dispatch.ts", "src/lib/feedback/retry-queued.ts"]) {
    assert(/whenBusy: "lane",/.test(read(rel)), `${rel} waits behind the open run`);
  }
});

check("a busy project never queues a message it has no run for", () => {
  // The claim gate holds a busy project's row back by its run; a row without
  // one is claimable at once and would be typed into the session it was
  // meant to wait for.
  const src = read("src/lib/inject-core.ts");
  const busy = src.indexOf("const projectBusy =");
  const guard = src.indexOf("if (projectBusy && trackableIntent && !runId) {");
  const execute = src.indexOf("return await executeAndReport(");
  assert(busy > 0 && guard > busy && guard < execute, "an unrecorded busy message is queued");
  assert(/code: "run-not-recorded",/.test(src), "the refusal has no code");
});

check("feedback Implement still asks for its own lane", () => {
  assert(/whenBusy: "lane"/.test(read("src/lib/feedback/implement.ts")), "Implement would queue");
});

// ── a fresh one-off session ────────────────────────────────────────────────
// Probe 9e3658d9, 2026-11-12: "only run git status, then stop" was answered in
// the project's shared session, which then resumed its own plan and edited
// tests. A fresh session is its own lane for one prompt, or nothing.

check("a fresh session is a lane of its own whether or not the project is busy", () => {
  for (const projectBusy of [true, false, undefined]) {
    for (const whenBusy of [undefined, "queue", "lane"] as const) {
      assert(
        busyPlacement({ projectBusy, whenBusy, session: "fresh", ...full }) === "fresh",
        `busy=${projectBusy} whenBusy=${whenBusy}`,
      );
    }
  }
});

check("a shared session is unchanged by the option", () => {
  assert(
    busyPlacement({ projectBusy: true, whenBusy: undefined, session: "shared", ...full }) ===
      "queue",
    "shared + busy",
  );
  assert(
    busyPlacement({ projectBusy: false, whenBusy: undefined, session: "shared", ...full }) ===
      "now",
    "shared + free",
  );
});

check("a fresh session never falls back to the shared tab", () => {
  const src = read("src/lib/executor.ts");
  assert(
    /if \(placement === "fresh" && !plan\) \{\s*return \{\s*ok: false,/.test(src),
    "a fresh session without a lane is not refused",
  );
  assert(/code: "fresh-session-unavailable"/.test(src), "the refusal has no code");
  assert(
    /runtimeAvailable && !payload\.projectBusy && !payload\.queueOnly && !fresh/.test(src),
    "a fresh session can be typed straight into the live shared PTY",
  );
  assert(
    /plan && placement === "fresh" \? \{\} : \{ sessionId: payload\.sessionId \}/.test(src),
    "a fresh session resumes an earlier conversation",
  );
});

check("a fresh session's prompt says it is one-off and reports to its own file", () => {
  const out = promptForOneOff("only run git status, then stop", "orangecat~9e3658d9");
  assert(out.startsWith(ONE_OFF_SESSION_NOTE), "the note does not lead");
  assert(out.includes("only run git status, then stop"), "the request is gone");
  assert(out.includes("orangecat~9e3658d9.md"), "the handoff is not the lane's own file");
  assert(!/sessions\/orangecat\.md/.test(out), "it would report on the shared tab");
});

check("a fresh run is marked, and its tab is closed when it reports", () => {
  const plan = read("src/lib/orchestration/parallel-run.ts");
  assert(/oneOff: true/.test(plan), "the run is not marked one-off");
  assert(/if \(!oneOff && !PARALLEL_DISPATCH_ENABLED\) return null;/.test(plan), "flag rule moved");
  const close = read("src/lib/orchestration/close-sweep.ts");
  assert(
    /if \(outcome != null\) await closeOneOffTab\(run, sessionTab\);/.test(close),
    "not closed",
  );
  assert(
    /payload\?\.oneOff !== true\) return;/.test(close),
    "an ordinary lane would be closed too",
  );
  assert(/enqueueTabCommand\(run\.userId, "close_tab"/.test(close), "no close_tab is queued");
});

check("the option is on POST /api/inject and on the MCP loki_dispatch", () => {
  const route = read("src/app/api/inject/route.ts");
  assert(/session: z\.enum\(\["shared", "fresh"\]\)\.optional\(\)/.test(route), "route schema");
  assert(/notifyOnClose: announce, session \}/.test(route), "route does not pass it on");
  const tools = read("src/lib/mcp/tools.ts");
  assert(/session: z\s*\.enum\(\["shared", "fresh"\]\)/.test(tools), "tool schema");
  assert(/session: opts\?\.session/.test(read("src/lib/mcp/services.ts")), "service drops it");
});

if (failures) {
  console.log(`\nbusy-placement: ${failures} failed`);
  process.exit(1);
}
console.log("\nbusy-placement: all passed");
