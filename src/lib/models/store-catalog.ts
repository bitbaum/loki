import {
  CUSTOM_VENDOR_ID,
  VENDORS,
  vendorById,
  type VendorId,
  type VendorRegion,
} from "@/config/model-vendors";
import { DAY_MS, HTTP_TIMEOUT_MS, HOUR_MS } from "@/lib/constants/time";

/**
 * The model landscape, from ONE public source.
 *
 * ── Why OpenRouter's catalogue ───────────────────────────────────────────────
 * Every lab publishes its prices on its own page in its own layout, and a
 * table typed from those pages is stale the week after. OpenRouter lists
 * ~460 models from ~60 labs in one JSON, with price per token, context
 * length, release date, the Hugging Face id when the weights are open, and
 * Artificial Analysis' intelligence index for most of them — no key needed,
 * and it moves when the labs move. The store reads that, and says so. The
 * lab's own price page is one tap away for the number a person is actually
 * billed; they are the same for the major labs, and when they are not, the
 * lab's page wins.
 *
 * ── Nothing here is typed by hand ────────────────────────────────────────────
 * "Open weights" is `hugging_face_id` being present. "Intelligence" is the
 * index OpenRouter relays. A lab is a namespace. A model's direct vendor is
 * whichever Loki vendor claims that namespace (config/model-vendors.ts). The
 * only judgement in this file is `tierOf` and `valueScore`, both stated as
 * formulas and fixture-tested, so the page can explain its own ranking.
 *
 * ── What is pure and what is not ────────────────────────────────────────────
 * `shapeStoreCatalog` is pure: raw rows in, the store's shape out.
 * `fetchStoreCatalog` is the one network call, with an in-memory cache so a
 * page view never costs OpenRouter a request, and `refresh` for the "Check
 * for new models" button.
 */

/** One row as OpenRouter publishes it — only the fields read here. */
export type OpenRouterModel = {
  id: string;
  name?: string;
  created?: number;
  context_length?: number | null;
  hugging_face_id?: string | null;
  knowledge_cutoff?: string | null;
  pricing?: { prompt?: string; completion?: string };
  architecture?: {
    input_modalities?: string[] | null;
    output_modalities?: string[] | null;
  };
  supported_parameters?: string[] | null;
  reasoning?: { mandatory?: boolean } | null;
  benchmarks?: {
    artificial_analysis?: {
      intelligence_index?: number | null;
      coding_index?: number | null;
    } | null;
  } | null;
};

export type ModelTier = "economy" | "standard" | "frontier";

export type StoreModel = {
  /** The routed id ("moonshotai/kimi-k3") — what OpenRouter calls it. */
  id: string;
  /** The vendor-side id ("kimi-k3") — what a person types into Settings for a direct key. */
  model: string;
  name: string;
  /** The OpenRouter namespace: who made it. */
  lab: string;
  labLabel: string;
  /** The Loki vendor that serves this lab's models directly, when there is one. */
  vendor: VendorId | null;
  /** USD per million tokens; null when the vendor publishes no fixed price (a router). */
  inPerM: number | null;
  outPerM: number | null;
  context: number | null;
  /** Epoch ms when the vendor listed it, or null. */
  released: number | null;
  /** Listed within MODEL_STORE_NEW_DAYS of `now`. */
  isNew: boolean;
  free: boolean;
  /** A `:free` sibling of this model on OpenRouter, when one is listed. */
  freeVariant: string | null;
  /** Weights published — the model can be run on your own machine. */
  open: boolean;
  hfId: string | null;
  /** Artificial Analysis intelligence index (0–100), relayed by OpenRouter. Null when unrated. */
  index: number | null;
  codingIndex: number | null;
  vision: boolean;
  reasoning: boolean;
  tools: boolean;
  /** Knowledge cutoff as the vendor states it (ISO date), or null. */
  cutoff: string | null;
  tier: ModelTier;
};

export type StoreLab = {
  id: string;
  label: string;
  region: VendorRegion;
  count: number;
  openCount: number;
  /** The Loki vendor that serves this lab directly, or null: "via OpenRouter". */
  vendor: VendorId | null;
  /** Highest intelligence index among the lab's models, for ordering. */
  topIndex: number | null;
};

export type StoreCatalog = {
  fetchedAt: number;
  models: StoreModel[];
  labs: StoreLab[];
};

/** A model newer than this is drawn with a "new" mark in the store. */
export const MODEL_STORE_NEW_DAYS = 30;

/** Variants of a model that are not a different model: batch pricing, previews, dated snapshots. */
const VARIANT = /:(batch|free|online|nitro|thinking|extended|exacto)$/;
const DATED = /-(\d{4}|\d{8})$/;
const NOT_CHAT =
  /embed|whisper|tts|dall-?e|moderation|transcri|audio|realtime|speech|imagen|veo|lyria|image|banana|rerank|guard|computer-use|codex-mini/i;

/** Labs as a person says them, where the namespace does not read well on its own. */
const LAB_LABELS: Record<string, string> = {
  "x-ai": "xAI",
  "z-ai": "Z.ai",
  moonshotai: "Moonshot",
  mistralai: "Mistral",
  "meta-llama": "Meta",
  meta: "Meta",
  qwen: "Qwen (Alibaba)",
  deepseek: "DeepSeek",
  openai: "OpenAI",
  google: "Google",
  anthropic: "Anthropic",
  nvidia: "NVIDIA",
  minimax: "MiniMax",
  cohere: "Cohere",
  amazon: "Amazon",
  microsoft: "Microsoft",
  perplexity: "Perplexity",
  "bytedance-seed": "ByteDance Seed",
  bytedance: "ByteDance",
  tencent: "Tencent",
  xiaomi: "Xiaomi",
  baidu: "Baidu",
  stepfun: "StepFun",
  inclusionai: "inclusionAI (Ant)",
  "ibm-granite": "IBM Granite",
  ai21: "AI21",
  "aion-labs": "Aion Labs",
  nousresearch: "Nous Research",
  liquid: "Liquid",
  openrouter: "OpenRouter",
  thinkingmachines: "Thinking Machines",
  arcee: "Arcee",
  "arcee-ai": "Arcee",
  rekaai: "Reka",
  upstage: "Upstage",
  sakana: "Sakana",
  writer: "Writer",
  meituan: "Meituan",
  poolside: "Poolside",
};

/** Where a lab is, when it is not already a Loki vendor with a region. */
const LAB_REGIONS: Record<string, VendorRegion> = {
  qwen: "CN",
  "z-ai": "CN",
  moonshotai: "CN",
  deepseek: "CN",
  minimax: "CN",
  "bytedance-seed": "CN",
  bytedance: "CN",
  tencent: "CN",
  xiaomi: "CN",
  baidu: "CN",
  stepfun: "CN",
  inclusionai: "CN",
  meituan: "CN",
  mistralai: "EU",
  upstage: "US",
  sakana: null,
};

/** The direct Loki vendor for an OpenRouter namespace, from the vendor table. */
const VENDOR_BY_NAMESPACE = new Map<string, VendorId>(
  VENDORS.flatMap((v) => v.namespaces.map((ns) => [ns, v.id] as const)),
);

export function labLabel(ns: string): string {
  return (
    LAB_LABELS[ns] ??
    ns
      .split(/[-_]/)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ")
  );
}

function perMillion(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null; // -1 = varies (a router)
  return Math.round(n * 1_000_000 * 1000) / 1000;
}

/** The family a variant belongs to: "x-ai/grok-4.3:batch" and "x-ai/grok-4.3-20260301" → "x-ai/grok-4.3". */
export function modelFamily(model: string): string {
  return model.replace(VARIANT, "").replace(DATED, "");
}

/**
 * Economy / standard / frontier, from price and the index. Stated as a rule so
 * the page can say it: economy is under $2 per million output tokens;
 * frontier is $15 or more, or within five points of the smartest model
 * listed; everything else is standard. Price first because that is what the
 * person is deciding on; the index catches the cheap-but-frontier models the
 * Chinese labs ship, which a price rule alone would file as economy.
 */
export function tierOf(
  m: Pick<StoreModel, "outPerM" | "index">,
  topIndex: number | null,
): ModelTier {
  const nearTop = m.index !== null && topIndex !== null && m.index >= topIndex - 5;
  if ((m.outPerM !== null && m.outPerM >= 15) || nearTop) return "frontier";
  if (m.outPerM !== null && m.outPerM <= 2) return "economy";
  return "standard";
}

/**
 * Intelligence per dollar: the index divided by log2(2 + blended price), the
 * blend weighting output three to one because an answer is mostly output.
 * The log keeps a $0.10 model from beating a $1 model by a hundredfold on a
 * two-point difference. Null when the model is unrated — never guessed.
 */
export function valueScore(m: Pick<StoreModel, "inPerM" | "outPerM" | "index">): number | null {
  if (m.index === null) return null;
  const blended = 0.25 * (m.inPerM ?? 0) + 0.75 * (m.outPerM ?? 0);
  return Math.round((m.index / Math.log2(2 + blended)) * 10) / 10;
}

function toStoreModel(
  m: OpenRouterModel,
  now: number,
  freeIds: Set<string>,
): Omit<StoreModel, "tier"> | null {
  const slash = m.id.indexOf("/");
  if (slash <= 0) return null;
  const lab = m.id.slice(0, slash);
  if (lab.startsWith("~")) return null; // OpenRouter's alias namespaces (~openai/gpt-latest)
  const model = m.id.slice(slash + 1);
  if (NOT_CHAT.test(model)) return null;
  const out = m.architecture?.output_modalities;
  if (Array.isArray(out) && (!out.includes("text") || out.includes("image"))) return null;
  const inPerM = perMillion(m.pricing?.prompt);
  const outPerM = perMillion(m.pricing?.completion);
  const released = typeof m.created === "number" ? m.created * 1000 : null;
  const params = new Set(m.supported_parameters ?? []);
  const aa = m.benchmarks?.artificial_analysis;
  const index = typeof aa?.intelligence_index === "number" ? aa.intelligence_index : null;
  const codingIndex = typeof aa?.coding_index === "number" ? aa.coding_index : null;
  const freeSibling = `${modelFamily(m.id)}:free`;
  return {
    id: m.id,
    model,
    name: (m.name ?? model).replace(/^[^:]+:\s*/, ""),
    lab,
    labLabel: labLabel(lab),
    vendor: VENDOR_BY_NAMESPACE.get(lab) ?? null,
    inPerM,
    outPerM,
    context: typeof m.context_length === "number" ? m.context_length : null,
    released,
    isNew: released !== null && now - released <= MODEL_STORE_NEW_DAYS * DAY_MS,
    free: inPerM === 0 && outPerM === 0,
    freeVariant: !m.id.endsWith(":free") && freeIds.has(freeSibling) ? freeSibling : null,
    open: typeof m.hugging_face_id === "string" && m.hugging_face_id.length > 0,
    hfId: typeof m.hugging_face_id === "string" && m.hugging_face_id ? m.hugging_face_id : null,
    index,
    codingIndex,
    vision: (m.architecture?.input_modalities ?? []).includes("image"),
    reasoning: Boolean(m.reasoning) || params.has("reasoning"),
    tools: params.has("tools"),
    cutoff: typeof m.knowledge_cutoff === "string" ? m.knowledge_cutoff : null,
  };
}

/** Every lab in the catalogue, from the models themselves. */
export function labsOf(models: readonly StoreModel[]): StoreLab[] {
  const byLab = new Map<string, StoreLab>();
  for (const m of models) {
    const lab = byLab.get(m.lab) ?? {
      id: m.lab,
      label: m.labLabel,
      region: m.vendor ? (vendorById(m.vendor)?.region ?? null) : (LAB_REGIONS[m.lab] ?? "US"),
      count: 0,
      openCount: 0,
      vendor: m.vendor,
      topIndex: null,
    };
    lab.count += 1;
    if (m.open) lab.openCount += 1;
    if (m.index !== null && (lab.topIndex === null || m.index > lab.topIndex)) {
      lab.topIndex = m.index;
    }
    byLab.set(m.lab, lab);
  }
  return [...byLab.values()].sort(
    (a, b) => (b.topIndex ?? -1) - (a.topIndex ?? -1) || b.count - a.count,
  );
}

/** Raw catalogue rows → the store's models and labs. Pure. */
export function shapeStoreCatalog(
  raw: OpenRouterModel[],
  now = Date.now(),
): Pick<StoreCatalog, "models" | "labs"> {
  const freeIds = new Set(raw.map((m) => m.id).filter((id) => id.endsWith(":free")));
  const shaped = raw
    .map((m) => toStoreModel(m, now, freeIds))
    .filter((m): m is Omit<StoreModel, "tier"> => m !== null);
  const topIndex = shaped.reduce<number | null>(
    (top, m) => (m.index !== null && (top === null || m.index > top) ? m.index : top),
    null,
  );
  const models: StoreModel[] = shaped
    .map((m) => ({ ...m, tier: tierOf(m, topIndex) }))
    .sort((a, b) => (b.released ?? 0) - (a.released ?? 0));
  return { models, labs: labsOf(models) };
}

export type RunsVia = {
  /** A vendor the model can be reached through: the lab itself, or a router. */
  vendor: VendorId;
  /** The id to use there. */
  model: string;
  /** The person holds a key for it. */
  connected: boolean;
};

/**
 * Every way a person can run this model through Loki, directly first. A
 * `custom` row means they have their own endpoint; an open model can be
 * pulled there.
 */
export function runsVia(m: StoreModel, connected: ReadonlySet<string>): RunsVia[] {
  const out: RunsVia[] = [];
  if (m.vendor && m.vendor !== "openrouter") {
    out.push({ vendor: m.vendor, model: m.model, connected: connected.has(m.vendor) });
  }
  out.push({ vendor: "openrouter", model: m.id, connected: connected.has("openrouter") });
  if (m.open && connected.has(CUSTOM_VENDOR_ID)) {
    out.push({ vendor: CUSTOM_VENDOR_ID, model: m.model, connected: true });
  }
  return out;
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = HOUR_MS;

let cached: StoreCatalog | null = null;
let inflight: Promise<StoreCatalog | null> | null = null;

/**
 * The catalogue, from cache when fresh. `refresh` re-reads now (the button).
 * Null only when nothing has ever been read and the read fails; a failed
 * refresh keeps the last good read, with its older `fetchedAt` telling the
 * truth about how old it is.
 */
export async function fetchStoreCatalog(
  opts: {
    refresh?: boolean;
    fetchImpl?: typeof fetch;
    now?: number;
  } = {},
): Promise<StoreCatalog | null> {
  const now = opts.now ?? Date.now();
  if (!opts.refresh && cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached;
  if (inflight) return inflight;
  const run = async () => {
    try {
      const res = await (opts.fetchImpl ?? fetch)(OPENROUTER_MODELS_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) return cached;
      const body = (await res.json()) as { data?: OpenRouterModel[] };
      if (!Array.isArray(body.data) || body.data.length === 0) return cached;
      cached = { fetchedAt: now, ...shapeStoreCatalog(body.data, now) };
      return cached;
    } catch {
      return cached;
    } finally {
      inflight = null;
    }
  };
  inflight = run();
  return inflight;
}
