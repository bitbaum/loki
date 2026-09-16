/** Regression: a persisted READY handoff must retry run closure on later heartbeats. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/app/api/control/runtime-state/route.ts"),
  "utf8",
);

assert.match(
  source,
  /if \(p\.sessionStatus\?\.toLowerCase\(\) === SESSION_STATUS\.READY\)/,
  "every READY heartbeat must attempt to close its delivered run",
);
assert.doesNotMatch(
  source,
  /if \(updated && p\.sessionStatus\?\.toLowerCase\(\) === SESSION_STATUS\.READY\)/,
  "run closure must not depend on the session row changing again",
);

console.log("2 READY handoff self-heal checks passed");
