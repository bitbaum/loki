/**
 * A fresh one-off session ends with its run, however the run ended.
 *
 * #1640 closed a one-off's tab only when its own handoff closed the run. One
 * that never reported (reaped), was refused on its ack, or ended with a
 * runner restart kept its agent open in its lane: free to carry on with
 * something else, and holding a project lane and a builder agent session.
 *
 * Run: npx tsx scripts/test/one-off-close.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { closeChannelFor, oneOffTabToClose } from "@/lib/orchestration/one-off-close";

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

check("a closed one-off names its lane tab and its builder", () => {
  const got = oneOffTabToClose({
    oneOff: true,
    sessionTab: "orangecat~9e3658d9",
    oneOffChannel: "cloud",
  });
  assert(got?.tab === "orangecat~9e3658d9" && got.channel === "cloud", JSON.stringify(got));
});

check("a one-off without a recorded builder is still closed, on any builder", () => {
  const got = oneOffTabToClose({ oneOff: true, sessionTab: "loki~70d1a78d" });
  assert(got?.tab === "loki~70d1a78d" && got.channel === undefined, JSON.stringify(got));
  const odd = oneOffTabToClose({
    oneOff: true,
    sessionTab: "loki~70d1a78d",
    oneOffChannel: "moon",
  });
  assert(odd?.channel === undefined, "an unknown builder was passed on");
});

check("an ordinary parallel lane is not closed: its session is a person's", () => {
  assert(oneOffTabToClose({ sessionTab: "orangecat~9e3658d9" }) === null, "a lane was closed");
  assert(oneOffTabToClose({ oneOff: "yes", sessionTab: "orangecat~9e3658d9" }) === null, "truthy");
});

check("the project's shared tab is never closed by this", () => {
  assert(oneOffTabToClose({ oneOff: true, sessionTab: "orangecat" }) === null, "shared tab closed");
  assert(oneOffTabToClose({ oneOff: true }) === null, "no tab");
  assert(oneOffTabToClose(null) === null && oneOffTabToClose("x") === null, "bad payload");
});

check("the close hook closes a one-off on every close", () => {
  const src = read("src/lib/orchestration/notify-close.ts");
  const body = src.slice(src.indexOf("export async function notifyRunClosed"));
  assert(
    /^[^]*?\{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*void closeOneOffSession\(run\);/.test(body),
    "closeOneOffSession is not the first thing notifyRunClosed does (a return before it would skip it)",
  );
});

check("every close path calls the close hook", () => {
  const src = read("src/db/queries/orchestration-runs.ts");
  for (const fn of [
    "updateOrchestrationRun",
    "closeRunUndelivered",
    "closeRunAgentExited",
    "closeRunShipped",
    "cleanupStaleOrchestrationRuns",
    "closeRunsEndedByRunnerRestart",
  ]) {
    const start = src.indexOf(`export async function ${fn}(`);
    assert(start >= 0, `${fn} is gone`);
    const next = src.indexOf("\nexport ", start + 10);
    const body = src.slice(start, next === -1 ? undefined : next);
    assert(/notifyRunClosed\(/.test(body), `${fn} closes a run without the close hook`);
  }
});

check("the handoff close no longer closes the tab a second time", () => {
  const src = read("src/lib/orchestration/close-sweep.ts");
  assert(!/enqueueTabCommand/.test(src), "close-sweep queues its own close_tab too");
});

check("the close follows the dispatch to the builder it was moved to", () => {
  // Queued for the laptop while it was shut, then rerouted to the cloud.
  assert(closeChannelFor("cloud", "local") === "cloud", "closed on the builder it left");
  assert(closeChannelFor(undefined, "cloud") === "cloud", "no command: the recorded builder");
  assert(closeChannelFor("moon", "local") === "local", "an odd value is not a builder");
  assert(closeChannelFor(null, undefined) === undefined, "nothing known: any builder");
  const src = read("src/lib/orchestration/one-off-close.ts");
  assert(/getCommandById\(commandId\)/.test(src), "the dispatch command is not read");
  assert(/command\.userId === run\.userId/.test(src), "another account's command could steer it");
});

check("an MCP caller is told which lane its one-off runs in", () => {
  const src = read("src/lib/mcp/tools.ts");
  assert(/sessionTab: body\.sessionTab \?\? null,/.test(src), "the structured result drops it");
  assert(
    /fresh one-off session\$\{typeof body\.sessionTab === "string"/.test(src),
    "the text drops it",
  );
});

check("a refused fresh session says the real reason", () => {
  const src = read("src/lib/executor.ts");
  assert(
    /const open = await countOpenParallelLanes\(userId, payload\.projectKey, payload\.runId\)/.test(
      src,
    ),
    "the lane limit is assumed, not read",
  );
  assert(/could not set up a fresh session for \$\{name\} just now/.test(src), "no other reason");
});

if (failures) {
  console.log(`\none-off-close: ${failures} failed`);
  process.exit(1);
}
console.log("\none-off-close: all passed");
