import type { ChatLink } from "@/config/chat-models";
import {
  CUSTOM_VENDOR_ID,
  ownKeyLabel,
  vendorById,
  type OwnKeyConfig,
  type VendorId,
} from "@/config/model-vendors";
import { appUrl } from "@/lib/email";

/**
 * A user's own models, shaped for Loki's model walker.
 *
 * Each vendor the user brought becomes a link whose key lives in a per-call
 * `env` object — never `process.env` — under `BYOK_API_KEY_<VENDOR>`. A server
 * link's key names (GROQ_API_KEY, …) never appear in that object, so a user's
 * key cannot reach a server link and a server key cannot reach a user's link.
 * `scripts/test/own-model.ts` pins both halves.
 *
 * Until 2026-10-10 the links came from ai-kit's `byokChain`, which knows only
 * ai-kit's ten hosts. Loki's vendor table (config/model-vendors.ts) is wider —
 * the Chinese labs directly, and a person's own endpoint — so the link is
 * built here, with the same fields `byokChain` set: `byok: true` is what keeps
 * `chat-models.ts` from sizing a reader's own Groq key to the free-tier window,
 * and `dailyTokens: 0` keeps it out of the site's capacity sum.
 */
export const OWN_MODEL_KEY_ENV = "BYOK_API_KEY";

export { OWN_MODEL_SETTINGS_PATH } from "@/lib/own-model-path";

export type OwnModel = {
  /** The user's links in walk order — one per vendor, or several when `links` named them. */
  chain: ChatLink[];
  env: Record<string, string>;
  /** OpenRouter's attribution headers, when the vendor reads them. */
  extraHeaders?: Record<string, string>;
  /** "Anthropic · claude-opus-5.5 (+2 more)" — for provenance and the settings screen. Never a key. */
  label: string;
  /** The first vendor — what Loki thinks with. */
  vendor: string;
  /** Whose keys these are, so a call on them is counted to that person (own_model_usage). */
  userId?: string;
};

export type OwnModelOptions = {
  /** A model id, or `vendor/model`: that link moves to the front (the picker's choice). */
  startAt?: string;
  /**
   * The links to build, in order, instead of one-per-vendor. Lets one key carry
   * several models (a cheap one and a strong one on the same Anthropic key) —
   * the shape Auto routing needs. A vendor named here must be among `configs`.
   */
  links?: ReadonlyArray<{ vendor: VendorId; model: string }>;
};

export function keyEnvFor(vendor: string): string {
  return `${OWN_MODEL_KEY_ENV}_${vendor.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** One link at the vendor's host (or, for `custom`, the row's), the key read by name. */
function linkFor(config: OwnKeyConfig, model: string): ChatLink {
  const vendor = vendorById(config.vendor);
  if (!vendor) throw new Error(`Unknown vendor: ${config.vendor}`);
  const baseUrl = vendor.baseUrl ?? config.baseUrl;
  if (!baseUrl) throw new Error(`${config.vendor}: no endpoint`);
  return {
    provider: {
      id: vendor.id,
      baseUrl: baseUrl.replace(/\/$/, ""),
      keyEnv: keyEnvFor(vendor.id),
      models: [model],
      byok: true,
      dailyTokens: 0,
      ...(vendor.routed ? { routed: true } : {}),
    },
    model,
  };
}

/**
 * One or several configs → one chain. By default one link per config, in the
 * order given; `links` names the links instead. `startAt` moves a link to the
 * front: the composer's picker choosing where the user's own chain starts, as
 * it does for the free one.
 */
export function ownModelFrom(
  configs: OwnKeyConfig | OwnKeyConfig[],
  opts: OwnModelOptions | string = {},
): OwnModel {
  const { startAt, links } = typeof opts === "string" ? { startAt: opts } : opts;
  const list = Array.isArray(configs) ? configs : [configs];
  if (list.length === 0) throw new Error("ownModelFrom: no config");
  const byVendor = new Map(list.map((c) => [c.vendor, c] as const));
  const wanted = links?.length
    ? links.flatMap((l) => {
        const c = byVendor.get(l.vendor);
        return c ? [{ config: c, model: l.model }] : [];
      })
    : list.map((config) => ({ config, model: config.model }));
  if (wanted.length === 0) throw new Error("ownModelFrom: no link names a stored vendor");

  const chain: ChatLink[] = wanted.map(({ config, model }) => linkFor(config, model));
  const env: Record<string, string> = {};
  let extraHeaders: Record<string, string> | undefined;
  const site = { url: appUrl(), title: "Loki" };
  for (const config of list) {
    env[keyEnvFor(config.vendor)] = config.apiKey;
    if (vendorById(config.vendor)?.wantsAttribution) {
      extraHeaders = { ...(extraHeaders ?? {}), "HTTP-Referer": site.url, "X-Title": site.title };
    }
  }
  if (startAt) {
    const i = chain.findIndex(
      (l) => l.model === startAt || `${l.provider.id}/${l.model}` === startAt,
    );
    if (i > 0) chain.unshift(...chain.splice(i, 1));
  }
  const first = chain[0]!;
  const firstConfig = byVendor.get(first.provider.id as VendorId) ?? list[0]!;
  const label =
    ownKeyLabel({ ...firstConfig, model: first.model }) +
    (chain.length > 1 ? ` (+${chain.length - 1} more)` : "");
  const vendor =
    firstConfig.vendor === CUSTOM_VENDOR_ID && firstConfig.label
      ? firstConfig.label
      : (vendorById(firstConfig.vendor)?.label ?? firstConfig.vendor);
  return { chain, env, ...(extraHeaders ? { extraHeaders } : {}), label, vendor };
}

/** True for a link that carries a user's own key rather than one of the server's. */
export function isOwnModelLink(link: ChatLink): boolean {
  return link.provider.keyEnv.startsWith(OWN_MODEL_KEY_ENV);
}

/** True for the one vendor whose host is the user's own (lib/models/endpoint-guard.ts gates it). */
export function isOwnEndpointLink(link: ChatLink): boolean {
  return isOwnModelLink(link) && link.provider.id === CUSTOM_VENDOR_ID;
}

/**
 * The key for one link, from the right place.
 *
 * A user's link reads ONLY the per-call env — if it were allowed to fall back
 * to `process.env`, a deployment that happened to set BYOK_API_KEY would
 * answer every user's turn on the operator's account. A server link reads ONLY
 * `process.env`, so nothing a user supplies can stand in for a server key.
 *
 * Three answers: a key; "" for a user's keyless endpoint (send no header);
 * undefined for "not available" (the walker refuses the link).
 */
export function keyForLink(
  link: ChatLink,
  own: Pick<OwnModel, "env"> | undefined,
): string | undefined {
  return isOwnModelLink(link)
    ? own?.env[link.provider.keyEnv]
    : process.env[link.provider.keyEnv] || undefined;
}

/** Every secret in a per-call env, for masking a vendor's echo of one. */
export function ownModelSecrets(own: Pick<OwnModel, "env"> | undefined): string[] {
  return own ? Object.values(own.env).filter((v) => v.length > 0) : [];
}
