/**
 * "Use … instead" on a failure: an agent the project's builder has, never the
 * one that just failed (control/agent-switch.ts).
 *
 * Run: npx tsx scripts/test/agent-switch.ts
 */
import assert from "node:assert/strict";
import { agentToSwitchTo } from "../../src/components/control/agent-switch";

const catalog = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "grok", label: "Grok" },
];
const grokMissing =
  "Grok is not installed on the cloud builder, so nothing was started. Switch this project to an agent installed there, or install Grok on the cloud builder, then try again.";

assert.deepEqual(
  agentToSwitchTo(
    { builderAgents: ["claude", "codex"], builderChannel: "cloud" },
    grokMissing,
    catalog,
  ),
  { id: "claude", label: "Claude" },
  "the most capable agent the builder has",
);
assert.deepEqual(
  agentToSwitchTo({ builderAgents: null, builderChannel: "cloud" }, grokMissing, catalog),
  { id: "claude", label: "Claude" },
  "a cloud builder that has not reported still runs Claude",
);
assert.equal(
  agentToSwitchTo({ builderAgents: null, builderChannel: "local" }, grokMissing, catalog),
  null,
  "a computer we know nothing about gets no guess",
);
assert.deepEqual(
  agentToSwitchTo(
    { builderAgents: ["claude", "codex"], builderChannel: "cloud" },
    "Claude is not installed on this computer, so nothing was started.",
    catalog,
  ),
  { id: "codex", label: "Codex" },
  "never the agent that just failed",
);
assert.equal(agentToSwitchTo(undefined, grokMissing, catalog), null);
console.log("✓ agent-switch: offers an agent the builder has, never the one that failed");
