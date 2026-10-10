import { byokChain, byokLabel, byokVendor, type ByokConfig } from "@bitbaum/ai-kit/byok";
import type { ChatLink } from "@/config/chat-models";
import { appUrl } from "@/lib/email";

/**
 * A user's own models, shaped for Loki's model walker.
 *
 * `byokChain` returns a one-link chain whose key lives in a per-call `env`
 * object — never `process.env` — under one name. With several vendors that
 * name would collide, so each user link is re-keyed to `BYOK_API_KEY_<VENDOR>`
 * and the walker reads a link's key from the per-call object by that name. A
 * server link's key names (GROQ_API_KEY, …) never appear in it, so a user's
 * key cannot reach a server link and a server key cannot reach a user's link.
 * `scripts/test/own-model.ts` pins both halves.
 */
export const OWN_MODEL_KEY_ENV = "BYOK_API_KEY";

export { OWN_MODEL_SETTINGS_PATH } from "@/lib/own-model-path";

export type OwnModel = {
  /** The user's vendors in their order, each one link: what Loki walks. */
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

function keyEnvFor(vendor: string): string {
  return `${OWN_MODEL_KEY_ENV}_${vendor.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/**
 * One or several configs → one chain, in the order given. `startAt` (a model
 * id, or `vendor/model`) moves that vendor's link to the front: the composer's
 * picker choosing where the user's own chain starts, as it does for the free one.
 */
export function ownModelFrom(configs: ByokConfig | ByokConfig[], startAt?: string): OwnModel {
  const list = Array.isArray(configs) ? configs : [configs];
  if (list.length === 0) throw new Error("ownModelFrom: no config");
  const site = { url: appUrl(), title: "Loki" };
  const chain: ChatLink[] = [];
  const env: Record<string, string> = {};
  let extraHeaders: Record<string, string> | undefined;
  for (const config of list) {
    const built = byokChain(config, site);
    const name = keyEnvFor(config.vendor);
    for (const link of built.chain) {
      chain.push({ ...link, provider: { ...link.provider, keyEnv: name } });
    }
    env[name] = (built.env as Record<string, string>)[OWN_MODEL_KEY_ENV] ?? config.apiKey;
    if (built.extraHeaders) extraHeaders = { ...(extraHeaders ?? {}), ...built.extraHeaders };
  }
  if (startAt) {
    const i = chain.findIndex(
      (l) => l.model === startAt || `${l.provider.id}/${l.model}` === startAt,
    );
    if (i > 0) chain.unshift(...chain.splice(i, 1));
  }
  const first = chain[0]!;
  const firstConfig = list.find((c) => c.vendor === first.provider.id) ?? list[0]!;
  const label =
    byokLabel({ vendor: firstConfig.vendor, model: first.model }) +
    (chain.length > 1 ? ` (+${chain.length - 1} more)` : "");
  return {
    chain,
    env,
    ...(extraHeaders ? { extraHeaders } : {}),
    label,
    vendor: byokVendor(firstConfig.vendor)?.label ?? firstConfig.vendor,
  };
}

/** True for a link that carries a user's own key rather than one of the server's. */
export function isOwnModelLink(link: ChatLink): boolean {
  return link.provider.keyEnv.startsWith(OWN_MODEL_KEY_ENV);
}

/**
 * The key for one link, from the right place.
 *
 * A user's link reads ONLY the per-call env — if it were allowed to fall back
 * to `process.env`, a deployment that happened to set BYOK_API_KEY would
 * answer every user's turn on the operator's account. A server link reads ONLY
 * `process.env`, so nothing a user supplies can stand in for a server key.
 */
export function keyForLink(
  link: ChatLink,
  own: Pick<OwnModel, "env"> | undefined,
): string | undefined {
  return isOwnModelLink(link) ? own?.env[link.provider.keyEnv] : process.env[link.provider.keyEnv];
}

/** Every secret in a per-call env, for masking a vendor's echo of one. */
export function ownModelSecrets(own: Pick<OwnModel, "env"> | undefined): string[] {
  return own ? Object.values(own.env).filter((v) => v.length > 0) : [];
}
