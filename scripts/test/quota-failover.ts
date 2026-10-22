// A quota wall fails over through the providers, and a failure never reads "Done".
import assert from "node:assert/strict";
import {
  nextFailoverProvider,
  providersTriedAfter,
} from "../../src/lib/feedback/auto-reimplement-policy";
import { explainRunFailure } from "../../src/lib/feedback/failure-reason";
import { decisionKey, RECOMMEND } from "../../src/lib/feedback/recommend";
import { takenWords } from "../../src/components/feedback/DecisionCard";
import { AGENT_FALLBACK_ORDER } from "../../src/lib/agent-resolution";

// The chain carries forward and never repeats.
assert.deepEqual(providersTriedAfter(null, "claude"), ["claude"]);
assert.deepEqual(providersTriedAfter({ providersTried: ["claude"] }, "codex"), ["claude", "codex"]);
assert.deepEqual(providersTriedAfter({ providersTried: ["claude"] }, "claude"), ["claude"]);
assert.deepEqual(providersTriedAfter({ providersTried: "junk" }, null), []);

// Claude and Codex are out → the next is Cursor, then Antigravity, then Grok.
const order = [...AGENT_FALLBACK_ORDER];
assert.equal(nextFailoverProvider(order, ["claude", "codex"]), "cursor");
assert.equal(nextFailoverProvider(order, ["claude", "codex", "cursor"]), "gemini");
assert.equal(nextFailoverProvider(order, ["claude", "codex", "cursor", "gemini"]), "grok");
assert.equal(nextFailoverProvider(order, order), null, "all tried → stop");
// Only installed / not-spent agents are candidates.
assert.equal(
  nextFailoverProvider(order, ["claude"], (id) => id === "codex"),
  "codex",
);
assert.equal(
  nextFailoverProvider(order, ["claude", "codex"], (id) => id === "codex"),
  null,
);

// Exhausted: names who was tried and the next move.
const q = "claude: usage limit is exhausted";
const one = explainRunFailure(q, { tried: ["Claude Code"] });
assert.match(one, /Claude Code ran out of quota/);
assert.match(one, /Settings → Agent/);
const many = explainRunFailure(q, { tried: ["Claude Code", "Codex"] });
assert.match(many, /tried Claude Code, Codex/);
assert.match(many, /Settings → Agent|Retry/);
assert.match(explainRunFailure(q), /switch provider/);

// A tapped build never says "Done"; a new run is a new decision.
assert.doesNotMatch(takenWords({ kind: RECOMMEND.RETRY, label: "Try again", runs: 1 }), /^Done/);
assert.match(
  takenWords({ kind: RECOMMEND.FILE, label: "File away", runs: 0 }),
  /^Done — file away/,
);
assert.notEqual(
  decisionKey({ id: "f", dispatchedRunId: null }, { kind: RECOMMEND.BUILD }),
  decisionKey({ id: "f", dispatchedRunId: "r1" }, { kind: RECOMMEND.RETRY }),
);

console.log("quota-failover: ok");
