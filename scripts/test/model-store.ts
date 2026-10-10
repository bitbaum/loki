/**
 * The model landscape tells the truth about every model, from one live source.
 *
 * Pins: the catalogue shaper turns OpenRouter's rows into the store's shape
 * with per-million prices, routers as "varies", free models as free, open
 * weights read from the Hugging Face id and never guessed, the index relayed
 * as given, labs derived from the models with the direct Loki vendor where
 * one claims the namespace; non-chat and alias rows out; tiers and value
 * follow their stated formulas; filters and sorts keep unrated models last
 * rather than gone; and every way to run a model is listed, lit when the
 * person holds the key.
 *
 * Run: npx tsx scripts/test/model-store.ts
 */
import assert from "node:assert/strict";
import {
  labsOf,
  modelFamily,
  runsVia,
  shapeStoreCatalog,
  tierOf,
  valueScore,
  type OpenRouterModel,
} from "@/lib/models/store-catalog";
import {
  DEFAULT_FILTERS,
  applyFilters,
  parseFilters,
  serializeFilters,
  sortModels,
} from "@/lib/models/store-filters";
import { contextLabel, indexLabel, priceLabel, releasedLabel } from "@/components/models/format";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-10T12:00:00Z");
const days = (n: number) => Math.floor((NOW - n * DAY) / 1000);

const text = { output_modalities: ["text"], input_modalities: ["text"] };
const aa = (intelligence_index: number | null, coding_index: number | null = null) => ({
  artificial_analysis: { intelligence_index, coding_index },
});

// A slice shaped like the live catalogue on 2026-10-10.
const RAW: OpenRouterModel[] = [
  {
    id: "anthropic/claude-fable-5.1",
    name: "Anthropic: Claude Fable 5.1",
    created: days(40),
    context_length: 1000000,
    pricing: { prompt: "0.00001", completion: "0.00005" },
    architecture: { ...text, input_modalities: ["text", "image"] },
    supported_parameters: ["tools", "reasoning"],
    benchmarks: aa(72, 68),
  },
  {
    id: "anthropic/claude-haiku-5.5",
    name: "Anthropic: Claude Haiku 5.5",
    created: days(3),
    context_length: 1000000,
    pricing: { prompt: "0.000001", completion: "0.000005" },
    architecture: text,
    supported_parameters: ["tools"],
    benchmarks: aa(43),
  },
  {
    id: "moonshotai/kimi-k3",
    name: "MoonshotAI: Kimi K3",
    created: days(12),
    context_length: 1048576,
    hugging_face_id: "moonshotai/Kimi-K3",
    pricing: { prompt: "0.00000064", completion: "0.0000135" },
    architecture: text,
    supported_parameters: ["tools", "reasoning"],
    reasoning: { mandatory: false },
    benchmarks: aa(69),
  },
  {
    id: "moonshotai/kimi-k3:batch",
    name: "MoonshotAI: Kimi K3 (batch)",
    created: days(12),
    context_length: 1048576,
    hugging_face_id: "moonshotai/Kimi-K3",
    pricing: { prompt: "0.00000032", completion: "0.0000068" },
    architecture: text,
  },
  {
    id: "z-ai/glm-5.3",
    name: "Z.ai: GLM 5.3",
    created: days(20),
    context_length: 1000000,
    hugging_face_id: "zai-org/GLM-5.3",
    pricing: { prompt: "0.0000014", completion: "0.0000044" },
    architecture: text,
    supported_parameters: ["tools"],
    benchmarks: aa(66, 60),
    knowledge_cutoff: "2026-06-01",
  },
  {
    id: "qwen/qwen3.8-27b",
    name: "Qwen: Qwen3.8 27B",
    created: days(70),
    context_length: 262144,
    hugging_face_id: "Qwen/Qwen3.8-27B",
    pricing: { prompt: "0.0000001", completion: "0.0000004" },
    architecture: text,
    supported_parameters: ["tools"],
    benchmarks: aa(48),
  },
  {
    id: "qwen/qwen3.8-27b:free",
    name: "Qwen: Qwen3.8 27B (free)",
    created: days(70),
    context_length: 131072,
    hugging_face_id: "Qwen/Qwen3.8-27B",
    pricing: { prompt: "0", completion: "0" },
    architecture: text,
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b",
    name: "NVIDIA: Nemotron 3 Super 120B",
    created: days(200),
    context_length: 262144,
    hugging_face_id: "nvidia/Nemotron-3-Super-120B-A12B",
    pricing: { prompt: "0.0000002", completion: "0.0000006" },
    architecture: text,
    supported_parameters: ["tools"],
  },
  {
    id: "openrouter/auto",
    name: "Auto Router",
    created: days(1000),
    context_length: 2000000,
    pricing: { prompt: "-1", completion: "-1" },
    architecture: text,
  },
  {
    id: "google/gemini-nano-banana-2.1",
    name: "Google: Nano Banana 2.1",
    created: days(4),
    context_length: 65536,
    pricing: { prompt: "0.0000015", completion: "0.0000075" },
    architecture: { output_modalities: ["text", "image"], input_modalities: ["text"] },
  },
  {
    id: "openai/whisper-1",
    name: "OpenAI: Whisper",
    created: days(900),
    context_length: null,
    pricing: { prompt: "0.000001", completion: "0" },
    architecture: text,
  },
  {
    id: "~anthropic/claude-fable-latest",
    name: "Anthropic: Claude Fable (latest)",
    created: days(1),
    context_length: 1000000,
    pricing: { prompt: "0.00001", completion: "0.00005" },
    architecture: text,
  },
];

console.log("model-store:");

const { models, labs } = shapeStoreCatalog(RAW, NOW);
const byId = Object.fromEntries(models.map((m) => [m.id, m]));

check("prices are per million; a router is 'varies'; a free model is free", () => {
  const fable = byId["anthropic/claude-fable-5.1"]!;
  assert.equal(fable.inPerM, 10);
  assert.equal(fable.outPerM, 50);
  assert.equal(priceLabel(fable), "$10 in · $50 out");
  const auto = byId["openrouter/auto"]!;
  assert.equal(auto.inPerM, null);
  assert.equal(priceLabel(auto), "varies");
  const free = byId["qwen/qwen3.8-27b:free"]!;
  assert.equal(free.free, true);
  assert.equal(priceLabel(free), "free");
});

check("open weights come from the Hugging Face id, never from the name", () => {
  assert.equal(byId["moonshotai/kimi-k3"]!.open, true);
  assert.equal(byId["moonshotai/kimi-k3"]!.hfId, "moonshotai/Kimi-K3");
  assert.equal(byId["anthropic/claude-fable-5.1"]!.open, false);
  assert.equal(byId["nvidia/nemotron-3-super-120b-a12b"]!.open, true);
});

check("the index, vision, reasoning, tools, cutoff and the free sibling are read as given", () => {
  const kimi = byId["moonshotai/kimi-k3"]!;
  assert.equal(kimi.index, 69);
  assert.equal(kimi.reasoning, true);
  assert.equal(kimi.tools, true);
  assert.equal(kimi.vision, false);
  assert.equal(byId["anthropic/claude-fable-5.1"]!.vision, true);
  assert.equal(byId["z-ai/glm-5.3"]!.cutoff, "2026-06-01");
  assert.equal(byId["z-ai/glm-5.3"]!.codingIndex, 60);
  assert.equal(byId["nvidia/nemotron-3-super-120b-a12b"]!.index, null, "unrated stays null");
  assert.equal(byId["qwen/qwen3.8-27b"]!.freeVariant, "qwen/qwen3.8-27b:free");
  assert.equal(byId["moonshotai/kimi-k3"]!.freeVariant, null);
  assert.equal(indexLabel(69.4), "69");
  assert.equal(indexLabel(null), "—");
});

check("image generators, speech models and alias namespaces are not in the landscape", () => {
  assert.ok(!models.some((m) => m.model.includes("banana")));
  assert.ok(!models.some((m) => m.model.includes("whisper")));
  assert.ok(!models.some((m) => m.lab.startsWith("~")));
  assert.ok(byId["moonshotai/kimi-k3:batch"], "a batch variant is a real, cheaper way to run it");
  assert.equal(modelFamily("deepseek-v4-pro-0813"), "deepseek-v4-pro");
});

check("labs are derived from the models, with the direct Loki vendor where one exists", () => {
  const moonshot = labs.find((l) => l.id === "moonshotai")!;
  assert.equal(moonshot.label, "Moonshot");
  assert.equal(moonshot.vendor, "moonshot");
  assert.equal(moonshot.region, "CN");
  assert.equal(moonshot.count, 2);
  assert.equal(moonshot.openCount, 2);
  assert.equal(moonshot.topIndex, 69);
  const nvidia = labs.find((l) => l.id === "nvidia")!;
  assert.equal(nvidia.vendor, null, "no direct vendor: via OpenRouter");
  assert.equal(nvidia.label, "NVIDIA");
  assert.equal(labs[0]!.id, "anthropic", "ordered by the smartest model each lab has");
  assert.equal(labsOf([]).length, 0);
  assert.equal(byId["qwen/qwen3.8-27b"]!.vendor, "alibaba");
  assert.equal(byId["qwen/qwen3.8-27b"]!.labLabel, "Qwen (Alibaba)");
});

check("tiers follow the stated rule: price first, then 'within five of the top'", () => {
  assert.equal(byId["anthropic/claude-fable-5.1"]!.tier, "frontier", "$50 out");
  assert.equal(byId["moonshotai/kimi-k3"]!.tier, "frontier", "69 is within five of 72");
  assert.equal(byId["z-ai/glm-5.3"]!.tier, "standard");
  assert.equal(byId["qwen/qwen3.8-27b"]!.tier, "economy");
  assert.equal(byId["anthropic/claude-haiku-5.5"]!.tier, "standard", "$5 out, index 43");
  assert.equal(tierOf({ outPerM: null, index: null }, 72), "standard", "a router is standard");
});

check("value is intelligence per dollar, null when unrated", () => {
  const kimi = valueScore(byId["moonshotai/kimi-k3"]!)!;
  const fable = valueScore(byId["anthropic/claude-fable-5.1"]!)!;
  const glm = valueScore(byId["z-ai/glm-5.3"]!)!;
  assert.ok(glm > kimi && kimi > fable, `${glm} > ${kimi} > ${fable}`);
  assert.equal(valueScore(byId["nvidia/nemotron-3-super-120b-a12b"]!), null);
});

check("every way to run a model is listed, lit when the key is held", () => {
  const kimi = byId["moonshotai/kimi-k3"]!;
  assert.deepEqual(runsVia(kimi, new Set()), [
    { vendor: "moonshot", model: "kimi-k3", connected: false },
    { vendor: "openrouter", model: "moonshotai/kimi-k3", connected: false },
  ]);
  const lit = runsVia(kimi, new Set(["openrouter", "custom"]));
  assert.equal(lit[1]!.connected, true);
  assert.deepEqual(lit[2], { vendor: "custom", model: "kimi-k3", connected: true });
  assert.equal(
    runsVia(byId["anthropic/claude-fable-5.1"]!, new Set(["custom"])).length,
    2,
    "closed weights cannot go to your endpoint",
  );
  assert.equal(runsVia(byId["openrouter/auto"]!, new Set()).length, 1, "a router is itself");
});

check("filters: open, free, vision, reasoning, mine, lab, price ceiling, search", () => {
  const reach = (m: { vendor: string | null }) => m.vendor === "moonshot";
  const f = (over: Partial<typeof DEFAULT_FILTERS>) =>
    applyFilters(models, { ...DEFAULT_FILTERS, ...over }, reach).map((m) => m.id);
  assert.ok(f({ open: true }).every((id) => byId[id]!.open));
  assert.deepEqual(f({ free: true }).sort(), ["qwen/qwen3.8-27b", "qwen/qwen3.8-27b:free"]);
  assert.deepEqual(f({ vision: true }), ["anthropic/claude-fable-5.1"]);
  assert.ok(f({ reasoning: true }).includes("moonshotai/kimi-k3"));
  assert.deepEqual(f({ mine: true }).sort(), ["moonshotai/kimi-k3", "moonshotai/kimi-k3:batch"]);
  assert.deepEqual(f({ lab: "z-ai" }), ["z-ai/glm-5.3"]);
  assert.ok(f({ max: 1 }).every((id) => (byId[id]!.outPerM ?? 99) <= 1));
  assert.ok(!f({ max: 1 }).includes("openrouter/auto"), "'varies' does not pass a ceiling");
  assert.deepEqual(f({ q: "glm" }), ["z-ai/glm-5.3"]);
  assert.deepEqual(f({ q: "moonshot" }).length, 2, "search matches the lab too");
});

check("sorts put what they cannot rank last, never out", () => {
  const smart = sortModels(models, "smart").map((m) => m.id);
  assert.equal(smart[0], "anthropic/claude-fable-5.1");
  assert.equal(smart.length, models.length);
  assert.equal(byId[smart[smart.length - 1]!]!.index, null);
  const cheap = sortModels(models, "cheap").map((m) => m.id);
  assert.equal(cheap[0], "qwen/qwen3.8-27b:free");
  assert.equal(cheap[cheap.length - 1], "openrouter/auto", "no price sorts last");
  assert.equal(sortModels(models, "new")[0]!.id, "anthropic/claude-haiku-5.5");
  assert.equal(sortModels(models, "context")[0]!.id, "openrouter/auto");
  // Intelligence per dollar: a 48 at $0.40 beats a 66 at $4.40 — that is the
  // point of the sort, and why "smartest" is a separate one.
  assert.equal(sortModels(models, "value")[0]!.id, "qwen/qwen3.8-27b");
});

check("filters round-trip through the URL, defaults omitted", () => {
  assert.equal(serializeFilters(DEFAULT_FILTERS), "");
  const f = { ...DEFAULT_FILTERS, open: true, lab: "qwen", max: 3, sort: "smart" as const, q: "k" };
  const qs = serializeFilters(f);
  assert.equal(qs, "q=k&open=1&lab=qwen&max=3&sort=smart");
  assert.deepEqual(parseFilters(new URLSearchParams(qs)), f);
  assert.equal(parseFilters(new URLSearchParams("sort=bogus&max=-2")).sort, "value");
  assert.equal(parseFilters(new URLSearchParams("max=-2")).max, null);
});

check("labels read as a person expects", () => {
  assert.equal(contextLabel(1048576), "1M ctx");
  assert.equal(contextLabel(500000), "500k ctx");
  assert.equal(contextLabel(1500000), "1.5M ctx");
  assert.equal(contextLabel(null), "");
  assert.equal(releasedLabel(null), "");
  assert.match(releasedLabel(NOW), /Oct 2026/);
});

console.log(`\nmodel-store: ${passed} passed`);
