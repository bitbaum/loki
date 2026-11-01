/**
 * A builder refuses to launch an agent CLI it does not have, in words
 * (src/lib/agents/launch-check.ts). Before, a Codex project sent to the cloud
 * builder opened a terminal on "codex: command not found" and the run read as
 * an agent that never answered.
 *
 * Run: npx tsx scripts/test/agent-launch-check.ts
 */
import assert from "node:assert/strict";
import { agentNotInstalledMessage, missingAgentReason } from "@/lib/agents/launch-check";

const cloud = agentNotInstalledMessage("Codex", "cloud");
assert.match(cloud, /^Codex is not installed on the cloud runner, so nothing was started\./);
assert.match(cloud, /Switch this project to an agent installed there/);
assert.match(cloud, /or install Codex on the cloud runner/);
assert.match(agentNotInstalledMessage("Grok", "local"), /not installed on this computer/);
assert.match(agentNotInstalledMessage("Grok", null), /not installed on this runner/);

assert.equal(missingAgentReason("claude", "cloud"), null, "Claude is never refused here");
assert.equal(
  missingAgentReason("no-such-agent", "cloud"),
  null,
  "unknown ids are refused elsewhere",
);

console.log("✓ agent-launch-check: 7 checks passed");
