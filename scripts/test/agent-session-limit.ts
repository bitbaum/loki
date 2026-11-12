// The cloud builder keeps a limited number of agent sessions open
// (lib/agent-session-limit): 27 at once took every site down on 2026-11-11.
import assert from "node:assert/strict";
import {
  AGENT_MAX_OPEN_DEFAULT,
  agentLimitRefusal,
  agentMaxOpen,
  openAgentCount,
} from "../../src/lib/agent-session-limit";
import { shellTabFromHex } from "../../src/lib/shell-session";

const shell = shellTabFromHex("deadbeef");
const tabs = (n: number): string[] => Array.from({ length: n }, (_, i) => `project-${i}`);

assert.equal(agentMaxOpen({}), AGENT_MAX_OPEN_DEFAULT);
// About 1 GiB a sealed session on a 15 GiB box shared with the sites.
assert.ok(AGENT_MAX_OPEN_DEFAULT <= 5, "the default leaves the sites their memory");
assert.equal(agentMaxOpen({ LOKI_AGENT_MAX_OPEN: "4" }), 4);
assert.equal(agentMaxOpen({ LOKI_AGENT_MAX_OPEN: "0" }), AGENT_MAX_OPEN_DEFAULT);
assert.equal(agentMaxOpen({ LOKI_AGENT_MAX_OPEN: "many" }), AGENT_MAX_OPEN_DEFAULT);

// Shells are counted by their own cap, not this one.
assert.equal(openAgentCount([...tabs(2), shell]), 2);

// Room left: allowed.
assert.equal(agentLimitRefusal({ channel: "cloud", tab: "new", openTabs: tabs(7), max: 8 }), null);
// Full: refused, in words that say what to do.
const refusal = agentLimitRefusal({ channel: "cloud", tab: "new", openTabs: tabs(8), max: 8 });
assert.match(refusal ?? "", /^8 agent sessions are already open on the cloud builder/);
assert.match(refusal ?? "", /Close one/);
// Full of shells is not full of agents.
assert.equal(
  agentLimitRefusal({ channel: "cloud", tab: "new", openTabs: [...tabs(7), shell], max: 8 }),
  null,
);
// A tab that is already open is re-attached, not a ninth session.
assert.equal(
  agentLimitRefusal({ channel: "cloud", tab: "Project-3", openTabs: tabs(8), max: 8 }),
  null,
);
// A person's own computer is not limited.
assert.equal(agentLimitRefusal({ channel: "local", tab: "new", openTabs: tabs(30), max: 8 }), null);
assert.equal(agentLimitRefusal({ channel: null, tab: "new", openTabs: tabs(30), max: 8 }), null);
console.log("✓ agent-session-limit");
