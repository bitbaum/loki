import { probeByokKey, rankByokModels, type ByokProbe } from "@bitbaum/ai-kit/byok-probe";
import type { ModelRecord } from "@bitbaum/ai-kit";
import {
  CUSTOM_VENDOR_ID,
  isAiKitVendor,
  vendorById,
  type OwnKeyConfig,
} from "@/config/model-vendors";
import { guardedFetch, parseEndpoint } from "@/lib/models/endpoint-guard";
import { HTTP_TIMEOUT_MS } from "@/lib/constants/time";

/**
 * "Does this key work, and what can it use?" — for EVERY vendor Loki knows.
 *
 * ai-kit's `probeByokKey` answers it for ai-kit's ten and is used unchanged.
 * Loki's extras (config/model-vendors.ts) and a person's own endpoint go
 * through the same two steps here — GET `/models` with the key, judge the
 * status in the vendor's own words, rank what came back with ai-kit's ranker
 * — so the settings screen sees one `ByokProbe` shape whoever the vendor is,
 * and `own-model-verdict.ts` keeps its four states.
 *
 * ai-kit's `readCatalog` would be the function to reuse; it is not in the
 * package's exports, so the thirty lines are here until it is.
 */
export type ProbeOptions = { fetchImpl?: typeof fetch; timeoutMs?: number };

export async function probeOwnKey(
  config: Pick<OwnKeyConfig, "vendor" | "apiKey" | "baseUrl">,
  opts: ProbeOptions = {},
): Promise<ByokProbe> {
  if (isAiKitVendor(config.vendor)) {
    return probeByokKey(config.vendor, config.apiKey, opts);
  }
  const vendor = vendorById(config.vendor);
  if (!vendor) return fail(null, "Unknown provider.");
  const key = config.apiKey.trim();
  if (/[\r\n\s]/.test(key)) return fail(null, "That doesn't look like a key.");

  let base: string;
  let fetchImpl = opts.fetchImpl ?? fetch;
  if (vendor.id === CUSTOM_VENDOR_ID) {
    const verdict = parseEndpoint(config.baseUrl ?? "");
    if (!verdict.ok) return fail(null, verdict.reason);
    base = verdict.baseUrl;
    fetchImpl = opts.fetchImpl ?? (guardedFetch as typeof fetch);
  } else {
    if (!key) return fail(null, `Paste your ${vendor.label} key.`);
    base = vendor.baseUrl!.replace(/\/$/, "");
  }

  const read = await readModels(`${base}/models`, key, fetchImpl, opts.timeoutMs);
  const label = vendor.id === CUSTOM_VENDOR_ID ? "Your endpoint" : vendor.label;
  if (read.status === null) {
    return fail(
      null,
      vendor.id === CUSTOM_VENDOR_ID
        ? `Couldn't reach your endpoint${read.error ? ` — ${read.error}` : ""}.`
        : `Couldn't reach ${label} to check the key — try again in a moment.`,
    );
  }
  if (read.status === 429) {
    return fail(429, `${label} is rate-limiting this key right now — it may still be valid.`);
  }
  if (read.status < 200 || read.status >= 300) {
    const said = read.message ? ` ${label} says: "${redact(read.message, key)}"` : "";
    if (vendor.id === CUSTOM_VENDOR_ID && read.status === 404) {
      return fail(
        read.status,
        `Your endpoint answered 404 at /models — is the URL the OpenAI-compatible base (it usually ends in /v1)?${said}`,
      );
    }
    if (vendor.id === CUSTOM_VENDOR_ID && !key && (read.status === 401 || read.status === 403)) {
      return fail(read.status, `Your endpoint wants a key — paste it above.${said}`);
    }
    return fail(read.status, `${label} didn't accept this key.${said}`);
  }
  const ranked = rankByokModels(read.records);
  return {
    ok: true,
    status: read.status,
    message:
      ranked.length > 0
        ? `${label === "Your endpoint" ? "Your endpoint answers" : `Your ${label} key works`} — ${ranked.length} model${ranked.length === 1 ? "" : "s"} available.`
        : `${label === "Your endpoint" ? "Your endpoint answers" : `Your ${label} key works`}. Type the model you want to use.`,
    models: ranked,
    suggested: ranked[0] ?? null,
  };
}

function fail(status: number | null, message: string): ByokProbe {
  return { ok: false, status, message, models: [], suggested: null };
}

/** Vendors echo the key back in their errors; what the reader sees must not carry it. */
function redact(text: string, key: string): string {
  return key ? text.split(key).join(`…${key.slice(-4)}`) : text;
}

type ModelsRead = {
  status: number | null;
  records: ModelRecord[];
  message: string | null;
  error: string | null;
};

/** One GET /models in the OpenAI shape, keeping the status and the vendor's own words. */
export async function readModels(
  url: string,
  key: string,
  fetchImpl: typeof fetch,
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<ModelsRead> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { status: null, records: [], message: null, error: errorText(e) };
  }
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  // The vendor's words only when it sent JSON; an HTML error page is not a sentence.
  const message = vendorMessage(body);
  const list = Array.isArray((body as { data?: unknown })?.data)
    ? ((body as { data: unknown[] }).data as Array<Record<string, unknown>>)
    : [];
  const records: ModelRecord[] = list.flatMap((m) => {
    if (typeof m.id !== "string") return [];
    const created = typeof m.created === "number" ? m.created * 1000 : null;
    const ctx = typeof m.context_length === "number" ? m.context_length : null;
    return [
      {
        id: m.id,
        outputModalities: null,
        costsNothing: null,
        tools: null,
        contextLength: ctx,
        expiresOn: null,
        created,
      },
    ];
  });
  return { status: res.status, records, message, error: null };
}

function vendorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  if (typeof err === "string") return err.slice(0, 160);
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m.slice(0, 160);
  }
  const m = (body as { message?: unknown }).message;
  return typeof m === "string" ? m.slice(0, 160) : null;
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // undici wraps the dialer's refusal; the cause carries the sentence.
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : null;
  return (cause ?? msg).slice(0, 160);
}
