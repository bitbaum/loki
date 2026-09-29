/**
 * A prompt sent into a Claude session that is showing a dialog answers the
 * dialog, not the agent. Farmhouse (2026-09-26) sat on "Teach auto mode about
 * your environment?"; the owner's widget note was injected, nothing ran, and
 * the run was NACKed 33s later. Claude reports the dialog itself in
 * ~/.claude/sessions/<pid>.json — {"status":"waiting","waitingFor":"dialog open"}.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeDialogOpen,
  claudeLiveSessionForDir,
  type ClaudeLiveSession,
} from "../../src/lib/control-fast-state";
import { screenExcerpt } from "../../desktop/src/main/pty-runtime";

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

// A fresh launch closes a dialog too, before the prompt goes in.
assert.match(
  poller,
  /if \(agent === 'claude'\) \{\s*await dismissClaudeDialog\(tab, resolveRunnerWorkspaceDir\(tab, effDir\)\)/,
  "a freshly launched Claude can open on a dialog",
);

// One folder, two spellings: Claude records the real path, the runner may
// hold a symlink or a trailing slash. Both must find the session, or a working
// Claude reads as "produced no response" (Petvity, 2026-09-28).
{
  const root = mkdtempSync(join(tmpdir(), "loki-cwd-"));
  const real = join(root, "real-petvity");
  mkdirSync(real);
  const link = join(root, "petvity");
  symlinkSync(real, link);
  const session: ClaudeLiveSession = { pid: 7, cwd: real, status: "busy", statusUpdatedAtS: 5 };
  const sessions = new Map([[real, session]]);
  assert.equal(claudeLiveSessionForDir(sessions, link)?.pid, 7, "symlinked folder");
  assert.equal(claudeLiveSessionForDir(sessions, `${real}/`)?.pid, 7, "trailing slash");
  assert.equal(claudeLiveSessionForDir(sessions, join(root, "other")), null, "another folder");
  assert.equal(
    claudeLiveSessionForDir(new Map([[join(real, "sub"), session]]), link)?.pid,
    7,
    "a subfolder of the workspace",
  );
}

// A failure with no known cause still quotes what the CLI drew.
{
  const excerpt = screenExcerpt(
    "\x1b[2J╭────╮\r\n│ Welcome to Claude Code │\r\n╰────╯\r\n> Teach auto mode about your environment?\r\n  1. Yes  2. No\r\n",
  );
  assert.match(excerpt, /Teach auto mode about your environment\?/);
  assert.doesNotMatch(excerpt, /\x1b|╭|│/, "no escape codes or box borders");
  assert.ok(screenExcerpt("x".repeat(2000)).length <= 321, "short enough for a Telegram line");
  assert.equal(screenExcerpt(""), "");
}

console.log("claude-dialog-not-a-composer: ok");
