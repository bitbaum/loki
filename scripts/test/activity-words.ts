// Activity says why a run failed in a person's words (activity-words).
import assert from "node:assert/strict";
import { plainFailure } from "../../src/components/activity/activity-words";

const said = (error: string | null, outcome = "failed") =>
  plainFailure({ error, outcome } as Parameters<typeof plainFailure>[0]);

// The three the owner met on 2026-11-11, as the runner wrote them.
assert.equal(
  said(
    "launched claude (pty) + injected, but Loki could not verify generation. claude is not authenticated (401 / login required) — the prompt was delivered but the agent can't run.",
  ),
  "The agent is signed out. Sign it in from the Terminal.",
);
assert.equal(
  said(
    "launched claude (pty) + injected, but Loki could not verify generation. claude's container failed to start: it exited before printing anything.",
  ),
  "The builder could not start the agent.",
);
assert.equal(
  said("launched gemini (pty) + injected, but Loki could not verify generation."),
  "The agent opened but never answered.",
);
// The ones that were already worded.
assert.equal(said("no running agent for 'substrata' on this runner"), "The agent did not start.");
assert.equal(said("usage limit reached"), "The AI provider's limit ran out.");
assert.equal(said(null), "It failed without saying why.");
// Nothing technical leaks through for the known causes.
for (const line of [said("x (pty) + injected, but Loki could not verify generation.")]) {
  assert.ok(!/pty|inject/i.test(line));
}
console.log("✓ activity-words");
