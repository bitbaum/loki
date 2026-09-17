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
  rankProviders,
  serializeProviderOrder,
  spentProviders,
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

console.log(`\nprovider-switch: ${passed} checks passed`);
