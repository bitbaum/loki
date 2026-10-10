/**
 * The model store tells the truth about every provider, from one live source.
 *
 * Pins: every vendor a reader can bring has a store entry (so a vendor added
 * to ai-kit cannot show up blank); the catalogue shaper turns OpenRouter's
 * rows into the store's shape with per-million prices, routers as "varies",
 * free models as free, batch/preview variants out of the featured few, one
 * per family, newest first; and the price labels read as a person expects.
 *
 * Run: npx tsx scripts/test/model-store.ts
 */
import assert from "node:assert/strict";
import { BYOK_VENDOR_IDS } from "@bitbaum/ai-kit/byok";
import { MODEL_STORE_VENDORS, storeVendor } from "@/config/model-store";
import {
  featuredOf,
  modelFamily,
  shapeStoreCatalog,
  type OpenRouterModel,
} from "@/lib/models/store-catalog";
import { contextLabel, priceLabel } from "@/components/models/format";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-10T12:00:00Z");
const days = (n: number) => Math.floor((NOW - n * DAY) / 1000);

// A slice shaped like the live catalogue on 2026-10-10.
const RAW: OpenRouterModel[] = [
  {
    id: "x-ai/grok-4.7",
    name: "xAI: Grok 4.7",
    created: days(19),
    context_length: 500000,
    pricing: { prompt: "0.000002", completion: "0.000006" },
    architecture: { output_modalities: ["text"] },
  },
  {
    id: "x-ai/grok-4.6",
    name: "xAI: Grok 4.6",
    created: days(59),
    context_length: 500000,
    pricing: { prompt: "0.000002", completion: "0.000006" },
    architecture: { output_modalities: ["text"] },
  },
  {
    id: "x-ai/grok-4.3:batch",
    name: "xAI: Grok 4.3 (batch)",
    created: days(163),
    context_length: 1000000,
    pricing: { prompt: "0.000001", completion: "0.000002" },
    architecture: { output_modalities: ["text"] },
  },
  {
    id: "anthropic/claude-haiku-5.5",
    name: "Anthropic: Claude Haiku 5.5",
    created: days(3),
    context_length: 1000000,
    pricing: { prompt: "0.0000001", completion: "0.0000005" },
    architecture: { output_modalities: ["text"] },
  },
  {
    id: "anthropic/claude-haiku-5.5:batch",
    name: "Anthropic: Claude Haiku 5.5 (batch)",
    created: days(3),
    context_length: 1000000,
    pricing: { prompt: "0.00000005", completion: "0.00000025" },
    architecture: { output_modalities: ["text"] },
  },
  {
    id: "anthropic/claude-opus-5.5",
    name: "Anthropic: Claude Opus 5.5",
    created: days(18),
    context_length: 1000000,
    pricing: { prompt: "0.000004", completion: "0.00002" },
    architecture: { output_modalities: ["text"] },
  },
  {
    id: "deepseek/deepseek-v4-pro-0813",
    name: "DeepSeek: V4 Pro (0813)",
    created: days(59),
    context_length: 1048576,
    pricing: { prompt: "0.00000066", completion: "0.00000198" },
    architecture: { output_modalities: ["text"] },
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek: V4 Pro",
    created: days(169),
    context_length: 1048576,
    pricing: { prompt: "0.0000009483", completion: "0.0000018966" },
    architecture: { output_modalities: ["text"] },
  },
  {
    id: "google/gemini-nano-banana-2.1",
    name: "Google: Nano Banana 2.1",
    created: days(4),
    context_length: 65536,
    pricing: { prompt: "0.0000015", completion: "0.0000075" },
    architecture: { output_modalities: ["text", "image"] },
  },
  {
    id: "google/gemini-3.8-flash",
    name: "Google: Gemini 3.8 Flash",
    created: days(38),
    context_length: 1048576,
    pricing: { prompt: "0.00000075", completion: "0.00000375" },
    architecture: { output_modalities: ["text"] },
  },
  {
    id: "openrouter/auto",
    name: "Auto Router",
    created: days(1000),
    context_length: 2000000,
    pricing: { prompt: "-1", completion: "-1" },
    architecture: { output_modalities: ["text"] },
  },
  {
    id: "openrouter/free",
    name: "Free Router",
    created: days(250),
    context_length: 200000,
    pricing: { prompt: "0", completion: "0" },
    architecture: { output_modalities: ["text"] },
  },
  {
    id: "openai/whisper-1",
    name: "OpenAI: Whisper",
    created: days(900),
    context_length: null,
    pricing: { prompt: "0.000001", completion: "0" },
    architecture: { output_modalities: ["text"] },
  },
  {
    id: "meta-llama/llama-4-maverick",
    name: "Meta: Llama 4 Maverick",
    created: days(400),
    context_length: 1000000,
    pricing: { prompt: "0.0000002", completion: "0.0000006" },
    architecture: { output_modalities: ["text"] },
  },
];

console.log("model-store:");

check("every vendor a reader can bring has a store entry with the human half filled in", () => {
  for (const id of BYOK_VENDOR_IDS) {
    const v = storeVendor(id);
    assert.ok(v, `${id} missing from the store`);
    assert.ok(v.blurb.length > 20 && v.knownFor.length > 10, `${id} blurb/knownFor`);
    assert.match(v.pricingUrl, /^https:\/\//);
    assert.match(v.asOf, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(v.namespaces.length > 0 || v.hosts, `${id}: a host must say what it serves`);
  }
  assert.equal(MODEL_STORE_VENDORS.length, BYOK_VENDOR_IDS.length);
});

const shaped = shapeStoreCatalog(RAW, NOW);
const byId = Object.fromEntries(shaped.map((v) => [v.id, v]));

check("prices are per million tokens; a router is 'varies'; a free model is free", () => {
  const grok = byId.xai!.all.find((m) => m.model === "grok-4.7")!;
  assert.equal(grok.inPerM, 2);
  assert.equal(grok.outPerM, 6);
  assert.equal(priceLabel(grok), "$2 in · $6 out");
  const auto = byId.openrouter!.all.find((m) => m.model === "auto")!;
  assert.equal(auto.inPerM, null);
  assert.equal(priceLabel(auto), "varies");
  const free = byId.openrouter!.all.find((m) => m.model === "free")!;
  assert.equal(free.free, true);
  assert.equal(priceLabel(free), "free");
});

check(
  "image generators and speech models are not chat models; a lab not in the store is ignored",
  () => {
    assert.ok(!byId.google!.all.some((m) => m.model.includes("banana")));
    assert.ok(!byId.openai!.all.some((m) => m.model.includes("whisper")));
    assert.ok(!shaped.some((v) => v.all.some((m) => m.id.startsWith("meta-llama/"))));
  },
);

check("featured: newest first, one per family, no batch variants, batch is not a family", () => {
  const xai = byId.xai!.featured.map((m) => m.model);
  assert.deepEqual(xai, ["grok-4.7", "grok-4.6"]);
  const anthropic = byId.anthropic!.featured.map((m) => m.model);
  assert.deepEqual(anthropic, ["claude-haiku-5.5", "claude-opus-5.5"]);
  // A dated snapshot is the same family as its undated id.
  assert.equal(modelFamily("deepseek-v4-pro-0813"), "deepseek-v4-pro");
  assert.deepEqual(
    byId.deepseek!.featured.map((m) => m.model),
    ["deepseek-v4-pro-0813"],
  );
  assert.deepEqual(featuredOf([]), []);
});

check("new = listed within 30 days; the count ignores batch variants", () => {
  assert.equal(byId.anthropic!.all.find((m) => m.model === "claude-haiku-5.5")!.isNew, true);
  assert.equal(byId.xai!.all.find((m) => m.model === "grok-4.6")!.isNew, false);
  assert.equal(byId.anthropic!.recentCount, 2); // haiku + opus, not haiku:batch
});

check("hosts have no namespace and therefore no live rows, by design", () => {
  for (const id of ["groq", "together", "cerebras"]) {
    assert.deepEqual(byId[id]!.all, []);
    assert.ok(storeVendor(id)!.hosts);
  }
});

check("context reads as a person says it", () => {
  assert.equal(contextLabel(1048576), "1M ctx");
  assert.equal(contextLabel(500000), "500k ctx");
  assert.equal(contextLabel(null), "");
});

console.log(`\nmodel-store: ${passed} passed`);
