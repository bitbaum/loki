import assert from "node:assert/strict";
import { cursorAdapter } from "@/lib/agents/cursor";
import { grokAdapter } from "@/lib/agents/grok";
import { addTrustedGrokFolder } from "../../desktop/src/main/grok-prep";

const cursor = cursorAdapter.buildLaunchCommand({ dir: "/tmp/project" });
assert.match(cursor, /cursor-agent --trust --yolo$/);

const grok = grokAdapter.buildLaunchCommand({ dir: "/tmp/project" });
assert.match(grok, /grok --always-approve --no-alt-screen$/);

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
