// Control counts a live run the way every other surface does: from the run's
// own record (Substrata on Antigravity, 2026-10-21 23:40: Control said
// "0 working · 0 awaiting input" while the project page said Working).
import assert from "node:assert/strict";
import { openRunReading } from "../../src/components/control/control-presenter";

const now = Date.parse("2026-10-21T22:00:00Z");
const base = {
  adapter: "x",
  intent: "x",
  state: "running",
  startedAt: "2026-10-21T21:40:00Z",
  finishedAt: null,
};
const fresh = new Date(now - 20_000).toISOString();
assert.equal(openRunReading({ ...base, lastProgressAt: fresh } as never, now), "working");
assert.equal(
  openRunReading({ ...base, lastProgressAt: fresh, blocked: "permission" } as never, now),
  "waiting",
);
assert.equal(openRunReading({ ...base, blocked: "auth" } as never, now), "waiting");
assert.equal(
  openRunReading({ ...base, lastProgressAt: "2026-10-21T20:00:00Z" } as never, now),
  null,
);
assert.equal(
  openRunReading({ ...base, finishedAt: fresh, lastProgressAt: fresh } as never, now),
  null,
);
assert.equal(openRunReading(null, now), null);
console.log("control-run-ssot: ok");
