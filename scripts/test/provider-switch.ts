/**
 * Inline tests for the provider chooser (src/lib/provider-switch.ts).
 *
 * This is the policy behind "one tap to a provider that still has quota". The
 * properties worth pinning are the ones that were WRONG before it existed:
 *
 *   • the agent that just hit the wall must never be offered as the way out
 *   • an agent the builder never reported installed must not be a one-tap
 *     button that quits a working CLI to launch a missing binary
 *   • a builder that reported NOTHING means unknown, not "all unavailable" —
 *     the control plane with no runner attached must still offer the switch
 *   • a run that failed for a non-quota reason is not evidence about quota
 *   • nothing is ever silently hidden: a provider that cannot answer still
 *     appears, disabled, with the reason
 *
 * Run: npx tsx scripts/test/provider-switch.ts
 */
import assert from "node:assert/strict";
import {
  PROVIDER_SPENT_WINDOW_MS,
  nextProvider,
  parseProviderOrder,
  preferredProviderOrder,
  currentProviderFor,
  describeProviderEvidence,
  rankProviders,
  serializeProviderOrder,
  spentProviders,
  routeAroundSpent,
} from "@/lib/provider-switch";
import { AGENT_FALLBACK_ORDER } from "@/lib/agent-resolution";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

// ── The operator's order ────────────────────────────────────────────────────

check("no saved order falls back to the fleet default", () => {
  assert.deepEqual(preferredProviderOrder(null), [...AGENT_FALLBACK_ORDER]);
  assert.deepEqual(preferredProviderOrder([]), [...AGENT_FALLBACK_ORDER]);
});

check("a saved order wins, and unranked agents follow rather than vanish", () => {
  const order = preferredProviderOrder(["grok", "codex"]);
  assert.deepEqual(order.slice(0, 2), ["grok", "codex"]);
  assert.equal(order.length, AGENT_FALLBACK_ORDER.length, "every agent is still reachable");
  assert.ok(order.includes("claude"));
});

check("junk and duplicates in a saved order are dropped, not trusted", () => {
  const order = preferredProviderOrder(["codex", "codex", "not-an-agent", ""]);
  assert.equal(order[0], "codex");
  assert.equal(order.filter((id) => id === "codex").length, 1);
  assert.equal(order.length, AGENT_FALLBACK_ORDER.length);
});

check("the stored string round-trips, and an all-junk list stores as null", () => {
  assert.equal(serializeProviderOrder(["grok", "claude"]), "grok,claude");
  assert.deepEqual(parseProviderOrder("grok,claude"), ["grok", "claude"]);
  assert.equal(parseProviderOrder(""), null);
  assert.equal(parseProviderOrder(null), null);
  assert.equal(parseProviderOrder("nonsense"), null);
  assert.equal(serializeProviderOrder(["nonsense"]), null);
});

// ── The ranking ─────────────────────────────────────────────────────────────

check("the agent that just died is never offered as the way out", () => {
  const options = rankProviders({ current: "claude" });
  assert.equal(
    options.some((o) => o.id === "claude"),
    false,
  );
  assert.equal(nextProvider(options)?.id !== "claude", true);
});

check("the one-tap target is the first USABLE provider in the operator's order", () => {
  const options = rankProviders({
    current: "claude",
    order: ["grok", "codex", "cursor"],
    installed: ["claude", "codex", "cursor"],
  });
  // grok is ranked first but is not installed, so the tap goes to codex.
  assert.equal(nextProvider(options)?.id, "codex");
});

check("an uninstalled provider still appears — disabled, with the reason", () => {
  const options = rankProviders({ current: "claude", installed: ["codex"] });
  const grok = options.find((o) => o.id === "grok");
  assert.ok(grok, "grok is listed rather than hidden");
  assert.equal(grok.usable, false);
  assert.equal(grok.block, "not-installed");
  assert.match(grok.reason ?? "", /not installed/i);
});

check("NOTHING reported is unknown, not unavailable", () => {
  // A control plane with no runner attached knows nothing about any agent.
  // Drawing that as "every provider unavailable" disables the one control the
  // operator came for.
  for (const installed of [null, undefined, []]) {
    const options = rankProviders({ current: "claude", installed });
    assert.ok(nextProvider(options), "a switch is still offered");
    assert.equal(
      options.every((o) => o.usable),
      true,
    );
  }
});

check("a provider observed out of quota is excluded, and says so", () => {
  const options = rankProviders({
    current: "claude",
    order: ["codex", "grok"],
    spent: { codex: "Codex hit a limit 5m ago — it may still be spent." },
  });
  const codex = options.find((o) => o.id === "codex");
  assert.equal(codex?.usable, false);
  assert.equal(codex?.block, "spent");
  assert.equal(nextProvider(options)?.id, "grok");
});

check("usable providers sort ahead of the ones that cannot answer", () => {
  const options = rankProviders({ current: "claude", installed: ["grok"] });
  const firstUnusable = options.findIndex((o) => !o.usable);
  const lastUsable = options.map((o) => o.usable).lastIndexOf(true);
  assert.ok(lastUsable < firstUnusable, "no usable row sits below an unusable one");
});

check("nothing usable is a real answer — null, not a button that cannot work", () => {
  const options = rankProviders({ current: "claude", installed: ["claude"] });
  assert.equal(nextProvider(options), null);
  assert.ok(options.length > 0, "the reasons are still there to read");
});

// ── Which agent is "current" ────────────────────────────────────────────────

check("a project with no stored preference still has a current agent", () => {
  // The gap this closes: agentPref null read as "nothing to exclude", so the
  // chooser offered Claude Code as the escape from a Claude Code rate limit.
  const current = currentProviderFor({ agentPref: null, defaultAdapter: "claude" });
  assert.equal(current, "claude");
  assert.equal(
    rankProviders({ current }).some((o) => o.id === "claude"),
    false,
  );
});

check("what it last RAN on outranks what it is configured to run on", () => {
  const current = currentProviderFor({
    agentPref: "claude",
    projectRuns: [{ adapter: "grok" }, { adapter: "claude" }],
    defaultAdapter: "claude",
  });
  assert.equal(current, "grok", "freshest run wins — that is the one that just died");
});

check("a run on an agent the chooser cannot offer is not 'current'", () => {
  const current = currentProviderFor({
    agentPref: "codex",
    projectRuns: [{ adapter: "openclaw" }],
    defaultAdapter: "claude",
  });
  assert.equal(current, "codex", "openclaw is not switchable — fall through to the preference");
});

// ── The evidence ────────────────────────────────────────────────────────────

check("a recent capacity wall marks that provider spent", () => {
  const spent = spentProviders(
    [{ adapter: "codex", error: "rate limit exceeded", startedAt: ago(5 * 60_000) }],
    NOW,
  );
  assert.ok(spent.codex);
  assert.match(spent.codex, /Codex/);
});

check("a failure that is not about capacity is not evidence about quota", () => {
  const spent = spentProviders(
    [{ adapter: "codex", error: "ENOENT: no such file or directory", startedAt: ago(60_000) }],
    NOW,
  );
  assert.deepEqual(spent, {}, "a crash on a bad path is not an empty tank");
});

check("a successful run leaves no mark", () => {
  assert.deepEqual(spentProviders([{ adapter: "codex", startedAt: ago(60_000) }], NOW), {});
  assert.deepEqual(
    spentProviders([{ adapter: "codex", error: null, startedAt: ago(60_000) }], NOW),
    {},
  );
});

check("a wall outside the window has expired — quota refills", () => {
  const spent = spentProviders(
    [
      {
        adapter: "grok",
        error: "quota exceeded",
        startedAt: ago(PROVIDER_SPENT_WINDOW_MS + 60_000),
      },
    ],
    NOW,
  );
  assert.deepEqual(spent, {});
});

check("an unknown adapter in the run log cannot inject a row", () => {
  const spent = spentProviders(
    [{ adapter: "openclaw", error: "rate limit", startedAt: ago(60_000) }],
    NOW,
  );
  assert.deepEqual(spent, {}, "only agents the chooser can offer may be marked spent");
});

check("the freshest wall per provider wins, and older ones do not overwrite it", () => {
  const spent = spentProviders(
    [
      { adapter: "codex", error: "rate limit", startedAt: ago(2 * 60_000) },
      { adapter: "codex", error: "usage limit", startedAt: ago(40 * 60_000) },
    ],
    NOW,
  );
  assert.match(spent.codex ?? "", /2m ago/);
});

// ── End to end: the walk the report asks for ────────────────────────────────

check("a rate-limited Claude run offers one tap to a provider that can answer", () => {
  const runs = [
    { adapter: "claude", error: "Claude usage limit reached", startedAt: ago(3 * 60_000) },
    { adapter: "cursor", error: "rate limit exceeded", startedAt: ago(20 * 60_000) },
  ];
  const options = rankProviders({
    current: "claude",
    order: ["cursor", "codex", "grok"],
    installed: ["claude", "cursor", "codex"],
    spent: spentProviders(runs, NOW),
  });
  const next = nextProvider(options);
  assert.equal(next?.id, "codex", "cursor is spent, grok is not installed → codex");
  // And the two that cannot answer still say why.
  assert.equal(options.find((o) => o.id === "cursor")?.block, "spent");
  assert.equal(options.find((o) => o.id === "grok")?.block, "not-installed");
});

// -- WHOSE MACHINE the installed list describes ------------------------------
// `installed` is one builder's capability report, pushed on a ~5 min heartbeat,
// and the chooser disables rows on it. Stated with no machine and no time it
// reads as "true now, everywhere" — which is how a cloud heartbeat could make a
// laptop-only agent read "not installed".

check("unknown availability says so, instead of implying nothing is installed", () => {
  const line = describeProviderEvidence({ channel: "local", observedAt: null }, false);
  assert.match(line, /unknown, not empty/);
  assert.ok(!/as observed/.test(line), "it must not claim an observation it never had");
});

check("a scoped answer names the machine it came from", () => {
  const local = describeProviderEvidence(
    { channel: "local", observedAt: new Date(Date.now() - 4 * 60_000).toISOString() },
    true,
  );
  assert.match(local, /This computer/);
  const cloud = describeProviderEvidence(
    { channel: "cloud", observedAt: new Date(Date.now() - 4 * 60_000).toISOString() },
    true,
  );
  assert.match(cloud, /cloud builder/);
  assert.ok(!/This computer/.test(cloud), "the cloud answer must not name the laptop");
});

check("with no project named, the list is the union and says so", () => {
  const line = describeProviderEvidence({ channel: null, observedAt: null }, true);
  assert.match(line, /across your builders/);
});

// ── A NEW dispatch does not walk into a known wall (routeAroundSpent) ──────
// 2026-09-25: Cursor refused a loki run at 10:13:46 ("usage limit is
// exhausted"); nine seconds later the next Implement launched Cursor again and
// sat silent for ten minutes. The chooser knew; nothing asked it first.
const CURSOR_SPENT = { cursor: "Cursor hit a limit 1m ago — it may still be spent." };
const rankFor = (
  preferred: string,
  spent: Record<string, string>,
  order?: string[],
  installed?: string[],
) =>
  rankProviders({ current: preferred, order: order ?? null, installed: installed ?? null, spent });

check("a preferred agent with no refusal on record is used as-is", () => {
  const out = routeAroundSpent({ preferred: "cursor", spent: {}, options: rankFor("cursor", {}) });
  assert.deepEqual(out, { agent: "cursor", rerouted: null });
});

check(
  "a spent preferred agent is routed to the next provider that can answer, and says why",
  () => {
    const out = routeAroundSpent({
      preferred: "cursor",
      spent: CURSOR_SPENT,
      options: rankFor("cursor", CURSOR_SPENT),
    });
    assert.equal(
      out.agent,
      AGENT_FALLBACK_ORDER.find((id) => id !== "cursor"),
    );
    assert.ok(out.rerouted, "the reroute must be reported, never silent");
    assert.equal(out.rerouted.from, "cursor");
    assert.match(out.rerouted.because, /Cursor hit a limit/);
  },
);

check("the operator's own ranking decides where it goes", () => {
  const out = routeAroundSpent({
    preferred: "cursor",
    spent: CURSOR_SPENT,
    options: rankFor("cursor", CURSOR_SPENT, ["grok", "codex", "claude"]),
  });
  assert.equal(out.agent, "grok");
});

check("an alternative that is itself spent or not installed is skipped", () => {
  const spent = {
    ...CURSOR_SPENT,
    claude: "Claude Code hit a limit 5m ago — it may still be spent.",
  };
  const out = routeAroundSpent({
    preferred: "cursor",
    spent,
    options: rankFor("cursor", spent, ["claude", "grok", "codex"], ["cursor", "claude", "codex"]),
  });
  assert.equal(
    out.agent,
    "codex",
    "claude is spent, grok is not installed — codex is the one that can answer",
  );
});

check("when nothing else can answer, it keeps the preferred agent rather than refusing", () => {
  const spent = Object.fromEntries(
    AGENT_FALLBACK_ORDER.map((id) => [id, `${id} hit a limit 1m ago — it may still be spent.`]),
  );
  const out = routeAroundSpent({ preferred: "cursor", spent, options: rankFor("cursor", spent) });
  assert.deepEqual(out, { agent: "cursor", rerouted: null });
});

console.log(`\nprovider-switch: ${passed} checks passed`);
