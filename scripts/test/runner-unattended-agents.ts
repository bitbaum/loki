import assert from "node:assert/strict";
import { codexAdapter } from "@/lib/agents/codex";
import { cursorAdapter } from "@/lib/agents/cursor";
import { geminiAdapter } from "@/lib/agents/gemini";
import { grokAdapter } from "@/lib/agents/grok";
import { addTrustedGrokFolder } from "../../desktop/src/main/grok-prep";

const cursor = cursorAdapter.buildLaunchCommand({ dir: "/tmp/project" });
assert.match(cursor, /cursor-agent --trust --yolo$/);

const grok = grokAdapter.buildLaunchCommand({ dir: "/tmp/project" });
assert.match(grok, /grok --always-approve --no-alt-screen$/);

// Resume: the root options before the subcommand, and a fresh session when
// the folder has none to continue.
const codex = codexAdapter.buildLaunchCommand({ dir: "/tmp/project", model: "gpt-5" });
assert.match(codex, /&& codex --model 'gpt-5' --no-alt-screen$/);
const resumed = codexAdapter.buildLaunchCommand({
  dir: "/tmp/project",
  model: "gpt-5",
  resumeLatest: true,
});
assert.match(
  resumed,
  /&& codex --model 'gpt-5' --no-alt-screen resume --last \|\| codex --model 'gpt-5' --no-alt-screen$/,
);

const added = addTrustedGrokFolder("", "/tmp/project", 123);
assert.match(added, /\[folders\."\/tmp\/project"\]\ntrusted = true\ndecided_at = 123/);

const upgraded = addTrustedGrokFolder(
  '[folders."/tmp/project"]\ntrusted = false\ndecided_at = 1\n',
  "/tmp/project",
  123,
);
assert.match(upgraded, /trusted = true/);
assert.doesNotMatch(upgraded, /trusted = false/);

assert.equal(addTrustedGrokFolder(added, "/tmp/project", 456), added, "already trusted is stable");

console.log("✓ unattended agent launch preparation");

// Gemini 0.65 stopped at "Allow execution of [Shell]?" on Substrata (2026-10-21).
assert.match(
  geminiAdapter.buildLaunchCommand({ dir: "/tmp/project" }),
  /gemini --skip-trust --approval-mode=yolo$/,
);
console.log("✓ gemini launches with auto-approve");
