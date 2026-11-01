// The Control hero's queue buttons must say what they did. "Run it in the
// cloud" used to fire and forget, so a tap that moved nothing looked exactly
// like a button that does not work (2026-10-12).
import { rerouteNotice, stopWaitingNotice } from "@/components/control/hero-actions";

let pass = 0;
const cases: Array<[string, boolean]> = [];
const check = (name: string, cond: boolean) => {
  cases.push([name, cond]);
  if (cond) pass++;
};

check(
  "reroute that moved two says so",
  rerouteNotice(true, { rerouted: 2, skipped: [] }) === "Handed 2 dispatches to the cloud runner.",
);
check(
  "reroute that moved nothing names why the first one stayed",
  rerouteNotice(true, {
    rerouted: 0,
    skipped: [{ projectKey: "loki", reason: "only this computer has this project's files" }],
  }).includes("only this computer has this project's files"),
);
check(
  "reroute with nothing to move does not claim a success",
  /already picked it up/.test(rerouteNotice(true, { rerouted: 0, skipped: [] })),
);
check(
  "a refused reroute carries the server's reason",
  rerouteNotice(false, { error: "The cloud runner is offline too." }) ===
    "The cloud runner is offline too.",
);
check(
  "stop waiting points at where the work went",
  /failed list below/.test(stopWaitingNotice(true, { stopped: 2 })),
);
check(
  "stop waiting with nothing stuck says a runner got there first",
  /picked it up/.test(stopWaitingNotice(true, { stopped: 0 })),
);
check("a failed stop says to try again", /try again/.test(stopWaitingNotice(false, {})));

for (const [name, ok] of cases) console.log(`${ok ? "✓" : "✗"} ${name}`);
console.log(`\n${pass}/${cases.length} passed`);
if (pass !== cases.length) process.exit(1);
