/**
 * Which model answers which kind of turn — Auto's rules, with plain numbers.
 *
 * Pins: a light turn never gets the frontier model under ANY stance (George's
 * rule); economy is the best value among cheap tool-capable models; standard
 * is at or above the median; frontier is the smartest reachable; a hand
 * choice wins and says so; the chain for a turn is the pick, then the
 * nearest tiers up before down, then every key's default, no duplicates;
 * a candidate that cannot call tools is never picked.
 *
 * Run: npx tsx scripts/test/auto-picks.ts
 */
import assert from "node:assert/strict";
import {
  STANCES,
  autoPicks,
  chainFor,
  resolvePicks,
  tierFor,
  type Candidate,
} from "@/lib/models/auto-picks";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const c = (
  vendor: Candidate["vendor"],
  model: string,
  index: number | null,
  inPerM: number | null,
  outPerM: number | null,
  tier: Candidate["tier"],
  tools: boolean | null = true,
): Candidate => ({ vendor, model, name: model, index, inPerM, outPerM, tier, tools });

// An Anthropic key and a Moonshot key, as the catalogue sees them.
const KEYS: Candidate[] = [
  c("anthropic", "claude-fable-5.1", 72, 10, 50, "frontier"),
  c("anthropic", "claude-opus-5.5", 68, 4, 20, "frontier"),
  c("anthropic", "claude-haiku-5.5", 43, 1, 5, "standard"),
  c("moonshot", "kimi-k3", 69, 0.64, 13.5, "frontier"),
  c("moonshot", "kimi-k2.6", 55, 0.47, 2.45, "standard"),
  c("moonshot", "kimi-k2-0905", 50, 0.6, 2.5, "standard"),
  c("moonshot", "kimi-tiny", 30, 0.1, 0.4, "economy"),
  c("moonshot", "kimi-no-tools", 60, 0.1, 0.4, "economy", false),
];

console.log("auto-picks:");

check("a light turn goes to the economy pick under every stance", () => {
  for (const s of STANCES) assert.equal(tierFor(s.id, "light"), "economy", s.id);
  assert.equal(tierFor("thrifty", "heavy"), "standard");
  assert.equal(tierFor("balanced", "heavy"), "frontier");
  assert.equal(tierFor("balanced", "standard"), "standard");
  assert.equal(tierFor("best", "standard"), "frontier");
});

check(
  "economy = best value among cheap tool-capable; standard ≥ median; frontier = smartest",
  () => {
    const picks = autoPicks(KEYS);
    const by = Object.fromEntries(picks.map((p) => [p.tier, p]));
    assert.equal(by.economy!.model, "kimi-tiny", "not kimi-no-tools, whatever its index");
    assert.equal(by.standard!.model, "kimi-k2.6", "55 ≥ median, best value below frontier");
    assert.equal(by.frontier!.model, "claude-fable-5.1");
    assert.equal(by.frontier!.vendor, "anthropic");
    assert.match(by.economy!.reason, /cheap/);
  },
);

check("one key with one model: every tier is that model, and the reasons say so", () => {
  const picks = autoPicks([c("groq", "openai/gpt-oss-120b", null, null, null, "standard", null)]);
  assert.equal(picks.length, 3);
  assert.ok(picks.every((p) => p.model === "openai/gpt-oss-120b"));
  assert.match(picks[0]!.reason, /cheapest/);
  assert.deepEqual(autoPicks([]), []);
});

check("a hand choice wins over the computed pick and says 'your choice'", () => {
  const picks = resolvePicks(autoPicks(KEYS), [
    { tier: "frontier", vendor: "moonshot", model: "kimi-k3" },
  ]);
  const frontier = picks.find((p) => p.tier === "frontier")!;
  assert.equal(frontier.model, "kimi-k3");
  assert.equal(frontier.chosenBy, "user");
  assert.equal(frontier.reason, "your choice");
  assert.equal(picks.find((p) => p.tier === "economy")!.chosenBy, "auto");
});

check("the chain: the pick, nearest tiers up before down, then defaults, no duplicates", () => {
  const picks = autoPicks(KEYS);
  const defaults = [
    { vendor: "anthropic" as const, model: "claude-fable-5.1" },
    { vendor: "moonshot" as const, model: "kimi-k3" },
  ];
  const light = chainFor("economy", picks, defaults).map((l) => `${l.vendor}/${l.model}`);
  assert.deepEqual(light, [
    "moonshot/kimi-tiny",
    "moonshot/kimi-k2.6",
    "anthropic/claude-fable-5.1",
    "moonshot/kimi-k3",
  ]);
  const standard = chainFor("standard", picks, defaults).map((l) => l.model);
  assert.deepEqual(standard, ["kimi-k2.6", "claude-fable-5.1", "kimi-tiny", "kimi-k3"]);
  const heavy = chainFor("frontier", picks, defaults).map((l) => l.model);
  assert.deepEqual(heavy, ["claude-fable-5.1", "kimi-k2.6", "kimi-tiny", "kimi-k3"]);
});

console.log(`\nauto-picks: ${passed} passed`);
