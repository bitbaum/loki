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
    /placement === "lane" && payload\.projectKey\s*\? await planParallelRun\(/.test(src),
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

check("feedback Implement still asks for its own lane", () => {
  assert(/whenBusy: "lane"/.test(read("src/lib/feedback/implement.ts")), "Implement would queue");
});

if (failures) {
  console.log(`\nbusy-placement: ${failures} failed`);
  process.exit(1);
}
console.log("\nbusy-placement: all passed");
