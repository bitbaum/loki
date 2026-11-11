// Home says in a sentence whether anything is running (lib/running-now).
import assert from "node:assert/strict";
import { runningNow } from "../../src/lib/running-now";

assert.equal(
  runningNow({ working: 0, waiting: 0 }).headline,
  "Nothing Loki started is running right now",
);
assert.equal(runningNow({ working: 1, waiting: 0 }).headline, "1 agent working now");
assert.equal(runningNow({ working: 3, waiting: 2 }).headline, "3 agents working now");
assert.equal(
  runningNow({ working: 0, waiting: 2 }).headline,
  "Nothing is working. Waiting for your reply",
);
// A negative count from a stale tally is not announced as work.
assert.equal(runningNow({ working: -1, waiting: 0 }).working, 0);
console.log("✓ running-now");
