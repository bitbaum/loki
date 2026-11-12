// Activity says why a run failed in a person's words (activity-words).
import assert from "node:assert/strict";
import { eventLine, plainFailure, plainLine } from "../../src/components/activity/activity-words";
import type { ActivityEvent } from "../../src/lib/activity-events";

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
  "The project folder is missing on that computer.",
);
assert.equal(
  said("agent stopped: the agent process exited (code 129)"),
  "The agent stopped partway.",
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
// The builder's sentences still on the page on 2026-11-12.
assert.equal(
  said("agent stopped: the agent process exited (code 129)"),
  "The agent stopped partway.",
);
assert.equal(
  said("Sandbox cwd does not exist: /home/g/dev/orangecat"),
  "The project folder is missing on that computer.",
);
assert.equal(
  said(
    "8 agent sessions are already open on the cloud builder, which is as many as it runs at once.",
  ),
  "Too many tasks were running at once. Run it again when one finishes.",
);
assert.equal(
  said("Dispatch failed: no runner picked it up within 5 minutes"),
  "No computer was free to take it.",
);
assert.equal(
  said("superseded: the same brief was typed into the live solon session by Grok Bot"),
  "Replaced by a newer request.",
);

// A row's line carries no links, session ids, hashes, setting names or paths.
assert.equal(
  plainLine(
    "MOVED HERE from a claude.ai cloud session (https://claude.ai/code/session_019MDtmXYZ). Continue the chat audit.",
  ),
  "Continue the chat audit.",
);
assert.equal(
  plainLine("QUEUE BEHIND CURRENT WORK (from Grok Bot for G / Cato). Finish what you started."),
  "Finish what you started.",
);
const partial = eventLine({
  status: "warning",
  outcomeLabel: "Partial",
  done: "Root cause: the cron route rejected the CRON_SECRET header — commit: 1be367d",
  ask: null,
  intentLabel: "Next best",
} as unknown as ActivityEvent);
assert.ok(!/CRON_SECRET|1be367d/.test(partial), partial);
assert.ok(partial.startsWith("Partial · Root cause:"), partial);
console.log("✓ activity-words");
