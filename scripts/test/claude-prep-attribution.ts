// A runner-launched claude signs commits without a model name
// (agent-execution/claude-prep). orangecat#1601 carried "Claude Opus 5.5".
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-prep-"));
process.env.HOME = home;

const settingsPath = path.join(home, ".claude", "settings.json");
const read = () => JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

void (async () => {
  const { ensureClaudeReady, AGENT_ATTRIBUTION } =
    await import("../../src/lib/agent-execution/claude-prep");

  // Nothing set: the model-free attribution is written.
  ensureClaudeReady(path.join(home, "work"));
  assert.deepEqual(read().attribution, AGENT_ATTRIBUTION);
  assert.ok(!/opus|sonnet|haiku|fable|\d/i.test(AGENT_ATTRIBUTION.commit));
  assert.ok(read().permissions.allow.includes("Bash"));

  // A person's own choice is kept, including "none".
  fs.writeFileSync(settingsPath, JSON.stringify({ attribution: { commit: "", pr: "" } }));
  ensureClaudeReady(path.join(home, "work"));
  assert.deepEqual(read().attribution, { commit: "", pr: "" });
  fs.writeFileSync(settingsPath, JSON.stringify({ attribution: false }));
  ensureClaudeReady(path.join(home, "work"));
  assert.equal(read().attribution, false);

  fs.rmSync(home, { recursive: true, force: true });
  console.log("✓ claude-prep-attribution");
})();
