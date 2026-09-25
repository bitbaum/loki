import { byokChain, byokLabel, type ByokConfig } from "@bitbaum/ai-kit/byok";
import type { ChatLink } from "@/config/chat-models";
import { appUrl } from "@/lib/email";

/**
 * A user's own model, shaped for Loki's model walker.
 *
 * `byokChain` returns a one-link chain whose key lives in a per-call `env`
 * object — never `process.env` — under this name. The walker reads a link's
 * key from that object first, and a server link's key names (GROQ_API_KEY, …)
 * never appear in it, so a user's key cannot reach a server link and a server
 * key cannot reach a user's link. `scripts/test/own-model.ts` pins that the
 * name here is the one ai-kit actually uses.
 */
export const OWN_MODEL_KEY_ENV = "BYOK_API_KEY";

/** Where a user connects, changes or removes their model — the AI tab of Settings. */
export const OWN_MODEL_SETTINGS_PATH = "/settings#ai";

export type OwnModel = {
  chain: ChatLink[];
  env: Record<string, string>;
  /** OpenRouter's attribution headers, when the vendor reads them. */
  extraHeaders?: Record<string, string>;
  /** "Anthropic · claude-opus-5.5" — for provenance and the settings screen. Never the key. */
  label: string;
  vendor: string;
};

export function ownModelFrom(config: ByokConfig): OwnModel {
  const { chain, env, extraHeaders } = byokChain(config, { url: appUrl(), title: "Loki" });
  return {
    chain,
    env: env as Record<string, string>,
    ...(extraHeaders ? { extraHeaders } : {}),
    label: byokLabel(config),
    vendor: config.vendor,
  };
}

/** True for a link that carries a user's own key rather than one of the server's. */
export function isOwnModelLink(link: ChatLink): boolean {
  return link.provider.keyEnv === OWN_MODEL_KEY_ENV;
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
