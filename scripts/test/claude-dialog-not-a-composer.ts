/**
 * A prompt sent into a Claude session that is showing a dialog answers the
 * dialog, not the agent. Farmhouse (2026-09-26) sat on "Teach auto mode about
 * your environment?"; the owner's widget note was injected, nothing ran, and
 * the run was NACKed 33s later. Claude reports the dialog itself in
 * ~/.claude/sessions/<pid>.json — {"status":"waiting","waitingFor":"dialog open"}.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claudeDialogOpen } from "../../src/lib/control-fast-state";

const base = { pid: 1, cwd: "/home/ubuntu/dev/farmhouse", statusUpdatedAtS: 1 };
assert.equal(claudeDialogOpen({ ...base, status: "waiting", waitingFor: "dialog open" }), true);
assert.equal(claudeDialogOpen({ ...base, status: "idle" }), false, "at the composer");
assert.equal(claudeDialogOpen({ ...base, status: "busy" }), false, "working");
assert.equal(
  claudeDialogOpen({ ...base, status: "waiting", waitingFor: "permission" }),
  false,
  "a permission prompt is a different wait",
);
assert.equal(claudeDialogOpen(null), false);

const reader = readFileSync("src/lib/control-fast-state.ts", "utf8");
assert.match(reader, /raw\.statusUpdatedAt \?\? raw\.updatedAt/, "current CLIs write updatedAt");

const poller = readFileSync("desktop/src/main/poller.ts", "utf8");
// The live session is found by the folder the agent REALLY runs in: on the box
// the dispatch still carries the laptop path, which no session has.
assert.ok(!/waitForAgentGenerating\(effDir,/.test(poller), "generation check uses the box path");
assert.match(poller, /await dismissClaudeDialog\(tab, liveDir\)/);
assert.match(poller, /claude is stuck on a dialog; starting a fresh session/);

console.log("claude-dialog-not-a-composer: ok");
