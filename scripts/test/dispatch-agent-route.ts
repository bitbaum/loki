/**
 * A task nobody pinned to an agent does not walk into one Loki has just
 * watched run out (src/lib/dispatch-agent-route.ts).
 *
 * Live 2026-11-12: the orangecat project's agent was Grok, whose Grok Build
 * balance was used up (402 Payment Required), and every chat message to it
 * failed in fifteen seconds while Claude Code, on the same builder, answered.
 * Kickoff, Implement and the retry already routed around a spent agent; the
 * chat's path (injectPrompt with no adapter) did not.
 *
 * Run: npx tsx scripts/test/dispatch-agent-route.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentRerouteSentence } from "@/lib/agent-reroute";
import { routeAroundSpent } from "@/lib/provider-switch";

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};
console.log("dispatch-agent-route:");

t("the sentence names both agents and says the project's agent is unchanged", () => {
  const s = agentRerouteSentence({ from: "grok", to: "claude", because: "x", why: "spent" });
  assert.match(s, /Grok/);
  assert.match(s, /Claude/);
  assert.match(s, /unchanged/);
  assert.match(s, /top up/);
});

t("a missing binary is said as such, not as a spent balance", () => {
  const s = agentRerouteSentence({
    from: "grok",
    to: "claude",
    because: "x",
    why: "not-installed",
  });
  assert.match(s, /cannot start/);
  assert.doesNotMatch(s, /run out/);
});

t("routeAroundSpent keeps the preferred agent when nothing says it is spent", () => {
  const d = routeAroundSpent({ preferred: "grok", spent: {}, options: [] });
  assert.equal(d.agent, "grok");
  assert.equal(d.rerouted, null);
});

const core = readFileSync("src/lib/inject-core.ts", "utf8");
t("injectPrompt routes only when the caller pinned no agent", () => {
  assert.match(core, /if \(!adapter\) \{\s*const routed = await agentAvoidingSpent\(/);
});
t("a rerouted run records where it came from, for the Watch page", () => {
  assert.match(core, /reroutedFrom: r\.from/);
});
const chat = readFileSync("src/app/api/conversations/[id]/messages/route.ts", "utf8");
t("the chat's dispatch reply says which agent took the task", () => {
  assert.match(chat, /inject\.body\.agentNotice/);
});

console.log(`  ${passed} passed`);
