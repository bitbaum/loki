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
// The ones the owner read raw on 2026-11-12.
assert.equal(
  said(
    "8 agent sessions are already open on the cloud builder, which is as many as it runs at once.",
  ),
  "Too many tasks were running at once. Run it again when one finishes.",
);
assert.equal(
  said("Sandbox cwd does not exist: /home/g/dev/orangecat"),
  "The project's folder is missing on the builder.",
);
assert.equal(
  said("agent stopped: the agent process exited (code 129)"),
  "The agent quit unexpectedly.",
);
assert.equal(
  said(
    "Dispatch failed before the prompt reached the agent: you stopped waiting from Control after no runner picked it up",
  ),
  "You cancelled it before it started.",
);
assert.equal(
  said("superseded: the same brief was typed into the live solon session"),
  "Replaced by a newer request.",
);
// An unknown cause is never printed raw.
assert.equal(said("ENOENT /var/x --flag"), "It failed — open it to see why.");
// Nothing technical leaks through for the known causes.
for (const line of [said("x (pty) + injected, but Loki could not verify generation.")]) {
  assert.ok(!/pty|inject/i.test(line));
}
console.log("✓ activity-words");
