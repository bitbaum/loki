import {
  BYOK_VENDORS,
  type ByokProbeSpec,
  type ByokVendor,
  type ByokVendorId,
} from "@bitbaum/ai-kit/byok";

/**
 * Every provider a person can bring a key for — Loki's SSOT, one row per vendor.
 *
 * ── Two halves, one table ────────────────────────────────────────────────────
 * ai-kit's `BYOK_VENDORS` is the fleet's closed list of hosts a server may send
 * a stranger's key to (ten of them). It is deliberately only that: id, host,
 * key page, how to probe. What a PERSON needs to choose a provider — who they
 * are, what they are known for, whether they give anything away, where the
 * bill and the spending cap live, which OpenRouter namespace their models sit
 * under — used to be spread over three Loki tables keyed by the same id
 * (`model-store.ts`, `own-model-vendors.ts`, and the probe routes' own enum).
 * Three tables keyed by one id are one table; this is it.
 *
 * ── Vendors beyond ai-kit ────────────────────────────────────────────────────
 * The labs that matter in 2026 are not all in ai-kit's ten: Kimi (Moonshot),
 * GLM (Z.ai), Qwen (Alibaba) and MiniMax ship frontier-class open weights at a
 * fraction of the price, and a person who wants them DIRECTLY — not through a
 * router — needs the host. ai-kit resolves from npm with an integrity hash, so
 * it cannot be changed from an agent session; the extras live here, in the
 * same shape, and are the next upstream PR. Every extra host below was checked
 * live with a fake key on 2026-10-10 and refused it with 401, exactly as
 * ai-kit's vendors do — which proves how each REJECTS, the half a probe needs.
 *
 * ── "custom": your own endpoint ──────────────────────────────────────────────
 * ai-kit refuses caller-supplied base URLs on SSRF grounds, and it is right to
 * as a library. Loki answers the objection instead of inheriting it: a custom
 * endpoint's URL is checked by `lib/models/endpoint-guard.ts` (https only, no
 * private address, re-checked at connect time) and nowhere else is a URL read
 * from a request. This is the path for a model on the person's own machine —
 * Ollama or LM Studio behind a tunnel — which is the only way a laptop becomes
 * a provider for a server that cannot reach `localhost`.
 *
 * Nothing here makes a network call or holds a key. Safe for a client bundle.
 */
export type VendorKind = "router" | "lab" | "host" | "custom";
export type VendorRegion = "US" | "EU" | "CN" | null;

export type ExtraVendorId = "moonshot" | "zai" | "alibaba" | "minimax" | "fireworks" | "custom";
export type VendorId = ByokVendorId | ExtraVendorId;

export const CUSTOM_VENDOR_ID = "custom" satisfies VendorId;

export type Vendor = {
  id: VendorId;
  label: string;
  /** OpenAI-compatible base, without `/chat/completions`. Null only for `custom` — the row carries it. */
  baseUrl: string | null;
  /** Where a reader creates a key. Null for `custom`. */
  keyUrl: string | null;
  keyHint: string;
  modelExample: string;
  routed?: boolean;
  wantsAttribution?: boolean;
  probe?: ByokProbeSpec;
  kind: VendorKind;
  /** Where the company is — people choose on this. */
  region: VendorRegion;
  /** OpenRouter namespaces whose models are this vendor's own. Empty for a host or router. */
  namespaces: readonly string[];
  /** One sentence: who they are. */
  blurb: string;
  /** What people choose them for, in the reader's terms. */
  knownFor: string;
  /** The vendor's own price list — the number they will actually be billed. */
  pricingUrl: string | null;
  /** Something for nothing, in the vendor's terms, or null. */
  freeTier: string | null;
  /** Where a person funds the key and caps what it can spend. */
  billingUrl: string | null;
  /** The vendor's own word for the spending cap, so the sentence on screen matches their page. */
  limit: string | null;
  /** When the prose was last checked against the vendor's site. */
  asOf: string;
};

type Human = Pick<
  Vendor,
  | "kind"
  | "region"
  | "namespaces"
  | "blurb"
  | "knownFor"
  | "pricingUrl"
  | "freeTier"
  | "billingUrl"
  | "limit"
  | "asOf"
>;

const AS_OF = "2026-10-10";

/** The human half for ai-kit's ten. A vendor added to ai-kit without a row here fails `scripts/test/model-vendors.ts`. */
const HUMAN: Record<ByokVendorId, Human> = {
  openrouter: {
    kind: "router",
    region: "US",
    namespaces: ["openrouter"],
    blurb: "One key that reaches models from every lab, billed in one place.",
    knownFor: "Trying anything without ten accounts; a credit limit per key; the free models",
    pricingUrl: "https://openrouter.ai/models",
    freeTier: "A set of free models (the ones ending in :free) with a daily cap",
    billingUrl: "https://openrouter.ai/settings/credits",
    limit: "a credit limit per key",
    asOf: AS_OF,
  },
  anthropic: {
    kind: "lab",
    region: "US",
    namespaces: ["anthropic"],
    blurb: "Makers of Claude — the models that run the coding agents most of the fleet uses.",
    knownFor: "Careful reasoning, long documents, writing that reads like a person wrote it",
    pricingUrl: "https://www.anthropic.com/pricing",
    freeTier: null,
    billingUrl: "https://console.anthropic.com/settings/billing",
    limit: "a monthly spend limit",
    asOf: AS_OF,
  },
  openai: {
    kind: "lab",
    region: "US",
    namespaces: ["openai"],
    blurb: "Makers of GPT — the widest range of models from tiny and cheap to frontier.",
    knownFor: "Tool use, structured output, a model for every budget",
    pricingUrl: "https://openai.com/api/pricing/",
    freeTier: null,
    billingUrl: "https://platform.openai.com/settings/organization/billing",
    limit: "a monthly budget",
    asOf: AS_OF,
  },
  google: {
    kind: "lab",
    region: "US",
    namespaces: ["google"],
    blurb: "Makers of Gemini — very long context and strong vision, at low prices.",
    knownFor: "Reading whole codebases or screenshots in one go; the Flash models for speed",
    pricingUrl: "https://ai.google.dev/pricing",
    freeTier: "A free tier in AI Studio with daily limits",
    billingUrl: "https://aistudio.google.com/plan_information",
    limit: "a billing budget",
    asOf: AS_OF,
  },
  xai: {
    kind: "lab",
    region: "US",
    namespaces: ["x-ai"],
    blurb: "Makers of Grok — frontier models with a large context and current knowledge.",
    knownFor: "Reasoning that takes its time; answers that cite what is happening now",
    pricingUrl: "https://docs.x.ai/docs/models",
    freeTier: null,
    billingUrl: "https://console.x.ai",
    limit: "a monthly spending limit",
    asOf: AS_OF,
  },
  deepseek: {
    kind: "lab",
    region: "CN",
    namespaces: ["deepseek"],
    blurb: "Open-weight frontier models at a fraction of the usual price.",
    knownFor: "Reasoning and code for very little money",
    pricingUrl: "https://api-docs.deepseek.com/quick_start/pricing",
    freeTier: null,
    billingUrl: "https://platform.deepseek.com/top_up",
    limit: "a prepaid balance",
    asOf: AS_OF,
  },
  mistral: {
    kind: "lab",
    region: "EU",
    namespaces: ["mistralai"],
    blurb: "European models, open and closed, with strong multilingual work.",
    knownFor: "European hosting and data terms; good small models; code (Devstral)",
    pricingUrl: "https://mistral.ai/pricing",
    freeTier: "A free experiment tier with rate limits",
    billingUrl: "https://console.mistral.ai/billing",
    limit: "a spending limit",
    asOf: AS_OF,
  },
  groq: {
    kind: "host",
    region: "US",
    namespaces: [],
    blurb: "Hosts open models on custom chips — the fastest answers you can buy.",
    knownFor: "Speed; a generous free tier that Loki's own free pool runs on",
    pricingUrl: "https://groq.com/pricing",
    freeTier: "A free tier with daily token and request limits",
    billingUrl: "https://console.groq.com/settings/billing",
    limit: "a monthly limit",
    asOf: AS_OF,
  },
  together: {
    kind: "host",
    region: "US",
    namespaces: [],
    blurb: "Hosts a large catalogue of open models with an easy pay-as-you-go account.",
    knownFor: "Breadth of open models; fine-tuning",
    pricingUrl: "https://www.together.ai/pricing",
    freeTier: null,
    billingUrl: "https://api.together.ai/settings/billing",
    limit: "a prepaid balance",
    asOf: AS_OF,
  },
  cerebras: {
    kind: "host",
    region: "US",
    namespaces: [],
    blurb: "Hosts open models on wafer-scale chips — Groq-class speed.",
    knownFor: "Very fast inference; a free tier",
    pricingUrl: "https://www.cerebras.ai/pricing",
    freeTier: "A free tier with daily limits",
    billingUrl: "https://cloud.cerebras.ai",
    limit: "a monthly limit",
    asOf: AS_OF,
  },
};

function fromAiKit(v: ByokVendor): Vendor {
  return {
    id: v.id,
    label: v.label,
    baseUrl: v.baseUrl,
    keyUrl: v.keyUrl,
    keyHint: v.keyHint,
    modelExample: v.modelExample,
    ...(v.routed ? { routed: true } : {}),
    ...(v.wantsAttribution ? { wantsAttribution: true } : {}),
    ...(v.probe ? { probe: v.probe } : {}),
    ...HUMAN[v.id],
  };
}

/** Hosts checked live 2026-10-10: each answers a fake key with 401 and its own sentence. */
const EXTRA: readonly Vendor[] = [
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    baseUrl: "https://api.moonshot.ai/v1",
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
    keyHint: "sk-…",
    modelExample: "kimi-k2.5",
    kind: "lab",
    region: "CN",
    namespaces: ["moonshotai"],
    blurb: "Makers of Kimi — open-weight frontier models with a million-token context.",
    knownFor: "Agentic coding and long documents at a tenth of the frontier price",
    pricingUrl: "https://platform.moonshot.ai/docs/pricing/chat",
    freeTier: null,
    billingUrl: "https://platform.moonshot.ai/console/pay",
    limit: "a prepaid balance",
    asOf: AS_OF,
  },
  {
    id: "zai",
    label: "Z.ai (GLM)",
    baseUrl: "https://api.z.ai/api/paas/v4",
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    keyHint: "",
    modelExample: "glm-5",
    kind: "lab",
    region: "CN",
    namespaces: ["z-ai"],
    blurb: "Makers of GLM — open-weight models built for agents and code, priced to run all day.",
    knownFor: "A coding plan that is a fraction of the US labs'; strong tool use",
    pricingUrl: "https://docs.z.ai/guides/overview/pricing",
    freeTier: "A free Flash model with rate limits",
    billingUrl: "https://z.ai/manage-apikey/billing",
    limit: "a prepaid balance",
    asOf: AS_OF,
  },
  {
    id: "alibaba",
    label: "Alibaba (Qwen)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    keyUrl: "https://modelstudio.console.alibabacloud.com/?tab=model#/api-key",
    keyHint: "sk-…",
    modelExample: "qwen-plus",
    kind: "lab",
    region: "CN",
    namespaces: ["qwen"],
    blurb: "Makers of Qwen — the widest family of open weights, from tiny to frontier.",
    knownFor: "Open weights at every size; vision and video; a free quota for new accounts",
    pricingUrl: "https://www.alibabacloud.com/help/en/model-studio/models",
    freeTier: "A free token quota for new accounts on most models",
    billingUrl: "https://usercenter2-intl.aliyun.com/billing",
    limit: "a prepaid balance",
    asOf: AS_OF,
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.io/v1",
    keyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    keyHint: "",
    modelExample: "MiniMax-M2",
    kind: "lab",
    region: "CN",
    namespaces: ["minimax"],
    blurb: "Makers of the M series — open-weight agent models, fast and cheap.",
    knownFor: "Agentic coding at very low cost; speech and video models too",
    pricingUrl: "https://platform.minimax.io/docs/guides/pricing",
    freeTier: null,
    billingUrl: "https://platform.minimax.io/user-center/payment/balance",
    limit: "a prepaid balance",
    asOf: AS_OF,
  },
  {
    id: "fireworks",
    label: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    keyUrl: "https://app.fireworks.ai/settings/users/api-keys",
    keyHint: "fw_…",
    modelExample: "accounts/fireworks/models/kimi-k2-instruct",
    kind: "host",
    region: "US",
    namespaces: [],
    blurb: "Hosts the open-weight frontier — DeepSeek, Kimi, Qwen, Llama — on fast serving.",
    knownFor: "Open models served fast with a US bill; fine-tuning",
    pricingUrl: "https://fireworks.ai/pricing",
    freeTier: "Starting credits for a new account",
    billingUrl: "https://app.fireworks.ai/settings/billing",
    limit: "a spend limit",
    asOf: AS_OF,
  },
  {
    id: "custom",
    label: "Your own endpoint",
    baseUrl: null,
    keyUrl: null,
    keyHint: "optional",
    modelExample: "llama3.3",
    kind: "custom",
    region: null,
    namespaces: [],
    blurb:
      "Any OpenAI-compatible server you run — Ollama or LM Studio on your laptop, vLLM on a box, a company gateway.",
    knownFor: "Free once the machine is yours; your data never leaves it",
    pricingUrl: null,
    freeTier: "Everything — it is your hardware",
    billingUrl: null,
    limit: null,
    asOf: AS_OF,
  },
];

/** Every vendor a person can bring: ai-kit's ten first, then Loki's extras, custom last. */
export const VENDORS: readonly Vendor[] = [...BYOK_VENDORS.map(fromAiKit), ...EXTRA];

export const VENDOR_IDS: readonly VendorId[] = VENDORS.map((v) => v.id);

export function vendorById(id: string): Vendor | undefined {
  return VENDORS.find((v) => v.id === id);
}

export function isVendorId(value: unknown): value is VendorId {
  return typeof value === "string" && VENDORS.some((v) => v.id === value);
}

/** True for a vendor whose host is ai-kit's — probed and called through ai-kit. */
export function isAiKitVendor(id: VendorId): id is ByokVendorId {
  return BYOK_VENDORS.some((v) => v.id === id);
}

/** Vendors in the order a picker shows them, grouped by kind. */
export const VENDOR_KIND_ORDER: readonly { kind: VendorKind; title: string }[] = [
  { kind: "router", title: "One key, every lab" },
  { kind: "lab", title: "The labs" },
  { kind: "host", title: "Hosts of open models" },
  { kind: "custom", title: "Your own machine" },
];

/**
 * A person's key and the model they chose. `apiKey` is "" for a keyless
 * endpoint (a tunnel to Ollama needs none); `baseUrl` and `label` only for
 * `custom`, where the host is the row's rather than the table's.
 */
export type OwnKeyConfig = {
  vendor: VendorId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  label?: string;
};

/**
 * A vendor id, a header value and a model id — not free text. Same bounds as
 * ai-kit's `isByokConfig`, plus: an empty key is allowed ONLY for `custom`,
 * and `custom` must carry a base URL (its shape is the endpoint guard's job).
 */
export function isOwnKeyConfig(input: unknown): input is OwnKeyConfig {
  if (!input || typeof input !== "object") return false;
  const { vendor, apiKey, model, baseUrl, label } = input as Record<string, unknown>;
  if (!isVendorId(vendor)) return false;
  if (typeof apiKey !== "string" || apiKey.length > 400 || /[\r\n\s]/.test(apiKey)) return false;
  if (apiKey.length > 0 && apiKey.length < 8) return false;
  if (apiKey.length === 0 && vendor !== CUSTOM_VENDOR_ID) return false;
  if (typeof model !== "string" || model.length < 1 || model.length > 200 || /[\r\n]/.test(model))
    return false;
  if (vendor === CUSTOM_VENDOR_ID) {
    if (typeof baseUrl !== "string" || baseUrl.length < 12 || baseUrl.length > 300) return false;
  } else if (baseUrl !== undefined) return false;
  if (label !== undefined && (typeof label !== "string" || label.length > 60)) return false;
  return true;
}

/** "Moonshot (Kimi) · kimi-k2.5" — for a footer or a prompt. Never the key. */
export function ownKeyLabel(config: Pick<OwnKeyConfig, "vendor" | "model" | "label">): string {
  const vendor = vendorById(config.vendor);
  const name = config.vendor === CUSTOM_VENDOR_ID && config.label ? config.label : vendor?.label;
  return `${name ?? config.vendor} · ${config.model}`;
}
