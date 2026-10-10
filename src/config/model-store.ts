import type { ByokVendorId } from "@bitbaum/ai-kit/byok";

/**
 * What a person needs to know to choose a provider — the part no catalogue
 * publishes. Prices, context and release dates come live from OpenRouter's
 * public catalogue (lib/models/store-catalog.ts); this file is the human
 * half: what each company is, what it is known for, whether it gives
 * anything away, and where its own price list lives.
 *
 * The store exists because Loki is model-agnostic on purpose: the person
 * decides who thinks for them and who they pay. That decision needs a fair
 * comparison, and a comparison that is wrong is worse than none — so every
 * hand-written claim here carries `asOf`, the vendor's own pricing page is
 * one tap away, and the numbers themselves are never typed here.
 *
 * `scripts/test/model-store.ts` pins that every vendor a reader can bring has
 * an entry, so a vendor added to ai-kit cannot appear in the store as a blank.
 */
export type StoreVendor = {
  id: ByokVendorId;
  /** One sentence: who they are. */
  blurb: string;
  /** What people choose them for, in the reader's terms. */
  knownFor: string;
  /** The vendor's own price list — the number they will actually be billed. */
  pricingUrl: string;
  /** Something for nothing, in the vendor's terms, or null when there is none. */
  freeTier: string | null;
  /**
   * OpenRouter namespaces whose models are this vendor's — how live prices
   * are matched. Empty for a HOST (Groq, Together, Cerebras): they serve
   * other labs' open models, and OpenRouter lists those under the lab.
   */
  namespaces: readonly string[];
  /** For a host: what it serves, since no namespace names it. */
  hosts: string | null;
  /** When the prose above was last checked against the vendor's site. */
  asOf: string;
};

export const MODEL_STORE_VENDORS: readonly StoreVendor[] = [
  {
    id: "openrouter",
    blurb: "One key that reaches models from every major lab, billed in one place.",
    knownFor: "Trying anything without ten accounts; a credit limit per key; the free models",
    pricingUrl: "https://openrouter.ai/models",
    freeTier: "A set of free models (the ones ending in :free) with a daily cap",
    namespaces: ["openrouter"],
    hosts: null,
    asOf: "2026-10-10",
  },
  {
    id: "anthropic",
    blurb: "Makers of Claude — the models that run the coding agents most of the fleet uses.",
    knownFor: "Careful reasoning, long documents, writing that reads like a person wrote it",
    pricingUrl: "https://www.anthropic.com/pricing",
    freeTier: null,
    namespaces: ["anthropic"],
    hosts: null,
    asOf: "2026-10-10",
  },
  {
    id: "openai",
    blurb: "Makers of GPT — the widest range of models from tiny and cheap to frontier.",
    knownFor: "Tool use, structured output, a model for every budget",
    pricingUrl: "https://openai.com/api/pricing/",
    freeTier: null,
    namespaces: ["openai"],
    hosts: null,
    asOf: "2026-10-10",
  },
  {
    id: "google",
    blurb: "Makers of Gemini — very long context and strong vision, at low prices.",
    knownFor: "Reading whole codebases or screenshots in one go; the Flash models for speed",
    pricingUrl: "https://ai.google.dev/pricing",
    freeTier: "A free tier in AI Studio with daily limits",
    namespaces: ["google"],
    hosts: null,
    asOf: "2026-10-10",
  },
  {
    id: "xai",
    blurb: "Makers of Grok — frontier models with a large context and current knowledge.",
    knownFor: "Reasoning that takes its time; answers that cite what is happening now",
    pricingUrl: "https://docs.x.ai/docs/models",
    freeTier: null,
    namespaces: ["x-ai"],
    hosts: null,
    asOf: "2026-10-10",
  },
  {
    id: "deepseek",
    blurb: "Open-weight frontier models from China at a fraction of the usual price.",
    knownFor: "Reasoning and code for very little money",
    pricingUrl: "https://api-docs.deepseek.com/quick_start/pricing",
    freeTier: null,
    namespaces: ["deepseek"],
    hosts: null,
    asOf: "2026-10-10",
  },
  {
    id: "mistral",
    blurb: "European models, open and closed, with strong multilingual work.",
    knownFor: "European hosting and data terms; good small models; code (Devstral)",
    pricingUrl: "https://mistral.ai/pricing",
    freeTier: "A free experiment tier with rate limits",
    namespaces: ["mistralai"],
    hosts: null,
    asOf: "2026-10-10",
  },
  {
    id: "groq",
    blurb: "Hosts open models on custom chips — the fastest answers you can buy.",
    knownFor: "Speed; a generous free tier that Loki's own free pool runs on",
    pricingUrl: "https://groq.com/pricing",
    freeTier: "A free tier with daily token and request limits",
    namespaces: [],
    hosts: "Open models: Llama, Qwen, GPT-OSS, Whisper for speech",
    asOf: "2026-10-10",
  },
  {
    id: "together",
    blurb: "Hosts a large catalogue of open models with an easy pay-as-you-go account.",
    knownFor: "Breadth of open models; fine-tuning",
    pricingUrl: "https://www.together.ai/pricing",
    freeTier: null,
    namespaces: [],
    hosts: "Open models: Llama, Qwen, DeepSeek, Mistral and many more",
    asOf: "2026-10-10",
  },
  {
    id: "cerebras",
    blurb: "Hosts open models on wafer-scale chips — Groq-class speed.",
    knownFor: "Very fast inference; a free tier",
    pricingUrl: "https://www.cerebras.ai/pricing",
    freeTier: "A free tier with daily limits",
    namespaces: [],
    hosts: "Open models: Llama, Qwen, GPT-OSS",
    asOf: "2026-10-10",
  },
];

export function storeVendor(id: string): StoreVendor | undefined {
  return MODEL_STORE_VENDORS.find((v) => v.id === id);
}

/** A model newer than this is drawn with a "new" mark in the store. */
export const MODEL_STORE_NEW_DAYS = 30;
/** How many models a vendor card shows before "all N". */
export const MODEL_STORE_FEATURED = 5;
