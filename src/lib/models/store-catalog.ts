import {
  MODEL_STORE_FEATURED,
  MODEL_STORE_NEW_DAYS,
  MODEL_STORE_VENDORS,
} from "@/config/model-store";
import { DAY_MS, HTTP_TIMEOUT_MS, HOUR_MS } from "@/lib/constants/time";

/**
 * Live prices for the model store, from ONE public source.
 *
 * ── Why OpenRouter's catalogue ───────────────────────────────────────────────
 * Every lab publishes its prices on its own page in its own layout, and a
 * table typed from those pages is stale the week after. OpenRouter lists
 * ~450 models from every major lab in one JSON, with price per token,
 * context length and release date, with no key needed, and it moves when the
 * labs move. The store reads that, and says so: "from OpenRouter's public
 * catalogue, read N minutes ago". The lab's own price page is one tap away
 * on every card for the number the person will actually be billed — they are
 * the same for the major labs, and when they are not, the lab's page wins.
 *
 * ── What is pure and what is not ────────────────────────────────────────────
 * `shapeStoreCatalog` is pure (fixture-tested): raw rows in, the store's
 * shape out. `fetchStoreCatalog` is the one network call, with an in-memory
 * cache so a page view never costs OpenRouter a request, and `refresh` for
 * the "Check for new models" button.
 */

/** One row as OpenRouter publishes it — only the fields read here. */
export type OpenRouterModel = {
  id: string;
  name?: string;
  created?: number;
  context_length?: number | null;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { output_modalities?: string[] | null };
};

export type StoreModel = {
  id: string;
  /** The vendor-side id ("grok-4.7"), what a person types into Settings. */
  model: string;
  name: string;
  vendor: string;
  /** USD per million tokens; null when the vendor does not publish a fixed price (a router). */
  inPerM: number | null;
  outPerM: number | null;
  context: number | null;
  /** Epoch ms when the vendor listed it, or null. */
  released: number | null;
  free: boolean;
  /** Listed within MODEL_STORE_NEW_DAYS of `now`. */
  isNew: boolean;
};

export type StoreVendorView = {
  id: string;
  featured: StoreModel[];
  /** Every current chat model matched to this vendor, newest first. */
  all: StoreModel[];
  recentCount: number;
};

export type StoreCatalog = {
  fetchedAt: number;
  vendors: StoreVendorView[];
};

/** Variants of a model that are not a different model: batch pricing, previews, dated snapshots. */
const VARIANT = /:(batch|free|online|nitro|thinking|extended)$/;
const DATED = /-(\d{4}|\d{8})$/;
const NOT_CHAT =
  /embed|whisper|tts|dall-?e|moderation|transcri|audio|realtime|speech|imagen|veo|lyria|image|banana|rerank|guard|computer-use|codex-mini/i;

function perMillion(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null; // -1 = varies (a router)
  return Math.round(n * 1_000_000 * 1000) / 1000;
}

/** "grok-4.7:batch" → "grok-4.7"; "deepseek-v4-pro-0813" → "deepseek-v4-pro". */
export function modelFamily(model: string): string {
  return model.replace(VARIANT, "").replace(DATED, "");
}

function toStoreModel(m: OpenRouterModel, vendor: string, now: number): StoreModel | null {
  const slash = m.id.indexOf("/");
  const model = slash === -1 ? m.id : m.id.slice(slash + 1);
  const out = m.architecture?.output_modalities;
  if (out && (!out.includes("text") || out.includes("image"))) return null;
  if (NOT_CHAT.test(model)) return null;
  const inPerM = perMillion(m.pricing?.prompt);
  const outPerM = perMillion(m.pricing?.completion);
  const released = m.created ? m.created * 1000 : null;
  return {
    id: m.id,
    model,
    name: m.name?.replace(/^[^:]+:\s*/, "") ?? model,
    vendor,
    inPerM,
    outPerM,
    context: m.context_length ?? null,
    released,
    free: inPerM === 0 && outPerM === 0,
    isNew: released !== null && now - released < MODEL_STORE_NEW_DAYS * DAY_MS,
  };
}

/**
 * The featured few: newest first, one per family, no batch/free/preview
 * variants, with a published price. Enough to compare; "all N" has the rest.
 */
export function featuredOf(all: StoreModel[]): StoreModel[] {
  const seen = new Set<string>();
  const out: StoreModel[] = [];
  for (const m of all) {
    if (VARIANT.test(m.model) || /preview|exp\b|-exp-/i.test(m.model)) continue;
    const fam = modelFamily(m.model);
    if (seen.has(fam)) continue;
    seen.add(fam);
    out.push(m);
    if (out.length >= MODEL_STORE_FEATURED) break;
  }
  return out;
}

export function shapeStoreCatalog(raw: OpenRouterModel[], now = Date.now()): StoreVendorView[] {
  return MODEL_STORE_VENDORS.map((vendor) => {
    const all = raw
      .filter((m) => vendor.namespaces.some((ns) => m.id.startsWith(`${ns}/`)))
      .map((m) => toStoreModel(m, vendor.id, now))
      .filter((m): m is StoreModel => m !== null)
      .sort((a, b) => (b.released ?? 0) - (a.released ?? 0));
    return {
      id: vendor.id,
      featured: featuredOf(all),
      all,
      recentCount: all.filter((m) => m.isNew && !VARIANT.test(m.model)).length,
    };
  });
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
      cached = { fetchedAt: now, vendors: shapeStoreCatalog(body.data, now) };
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
