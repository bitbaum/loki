import {
  ChainExhaustedError,
  chainFrom,
  complete,
  createHealthTracker,
  freeChain,
  usableChain,
  type Env,
  type Link,
} from "@bitbaum/ai-kit";
import { byokChain, type ByokConfig } from "@bitbaum/ai-kit/byok";
import { SITE } from "@/lib/site";

/**
 * The model call is ai-kit's `complete()`, never ours: no vendor SDK, no
 * hand-rolled fetch to a model, no pinned model id (fleet STACK.md, AI row).
 * `complete()` owns the chain walk, the per-link deadline, the empty-200 and
 * the three kinds of 429.
 *
 * Two ways to be served, and they never mix (fleet SHARED.md, "Your own
 * model", rule 4):
 *   - the free shared chain, from whichever vendor keys this deployment has
 *     (GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY — any one);
 *   - the person's own key, sealed at rest (lib/own-model.ts). Their key serves
 *     only their model and is never charged to the free budget or health.
 *
 * Nothing here logs a prompt or a reply.
 */
const ENV_PREFIX = "APP";
const health = createHealthTracker();

/** The free chain this deployment can walk. APP_MODEL picks a starting point, never a pin. */
export function freeLinks(env: Env): Link[] {
  return chainFrom(env[`${ENV_PREFIX}_MODEL`], usableChain(freeChain(ENV_PREFIX), env));
}

export function freeAvailable(env: Env): boolean {
  return freeLinks(env).length > 0;
}

export const MAX_PROMPT = 4_000;

export type AskOutcome =
  | { ok: true; text: string; servedBy: string; ownModel: boolean }
  | { ok: false; error: "not_configured" | "busy" | "empty_prompt" | "too_long" };

export async function ask(
  prompt: string,
  options: {
    env: Env;
    ownModel?: ByokConfig | null;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<AskOutcome> {
  const text = prompt.trim();
  if (!text) return { ok: false, error: "empty_prompt" };
  if (text.length > MAX_PROMPT) return { ok: false, error: "too_long" };

  const own = options.ownModel ?? null;
  let chain: Link[];
  let env = options.env;
  let extraHeaders: Record<string, string> | undefined;
  if (own) {
    ({ chain, env, extraHeaders } = byokChain(own, { url: SITE.url, title: SITE.title }));
  } else {
    chain = freeLinks(options.env);
    if (chain.length === 0) return { ok: false, error: "not_configured" };
  }

  try {
    const result = await complete({
      chain,
      env,
      extraHeaders,
      health: own ? undefined : health,
      messages: [
        { role: "system", content: `You are the assistant inside ${SITE.title}. Answer briefly.` },
        { role: "user", content: text },
      ],
      maxTokens: 800,
      temperature: 0.3,
      timeoutMs: 45_000,
      signal: options.signal,
      fetchImpl: options.fetchImpl,
    });
    return { ok: true, text: result.text, servedBy: result.id, ownModel: own !== null };
  } catch (error) {
    if (error instanceof ChainExhaustedError) return { ok: false, error: "busy" };
    throw error;
  }
}
