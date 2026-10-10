/**
 * What the composer's model picker is allowed to offer.
 *
 * ── Why this is a list of STARTING POINTS, not a pin ─────────────────────────
 * Loki does not run on a model, it runs on a CHAIN: strongest first, stepping
 * across vendors when one rots or runs dry (see config/chat-models.ts). A picker
 * that hard-pinned a model would reintroduce the single point of failure the
 * chain exists to remove. So a choice here names where the chain STARTS —
 * `chainFrom()` already has exactly that semantic — and the fallback below it
 * stays intact. The UI says so rather than implying a pin.
 *
 * ── The user's own keys come first ───────────────────────────────────────────
 * A person who brought keys (Settings → AI) sees those models at the top,
 * marked as theirs; picking one starts THEIR chain there. The server's own
 * chain follows, for everyone.
 *
 * ── Locked rows are real, never fake-enabled ─────────────────────────────────
 * A vendor whose key is not set on this server is listed and disabled, and the
 * way out is named: add your own key. Hiding it would answer "why can't I use
 * X?" with silence; enabling it would answer with a failed turn; naming a
 * server environment variable would answer a person with a deploy instruction.
 */
import { byokVendor } from "@bitbaum/ai-kit/byok";
import { getApiUserId } from "@/lib/session";
import { jsonOk, jsonError } from "@/lib/api/route-helpers";
import { CHAT_CHAIN, providerModels, usableChatChain } from "@/config/chat-models";
import { listOwnModels } from "@/db/queries/user-model-keys";
import { MODEL_STORE_PATH } from "@/lib/own-model-path";
import type { LokiModelOption, LokiModelsResponse } from "@/lib/loki/models";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  const options: LokiModelOption[] = [];

  const own = await listOwnModels(userId).catch(() => []);
  for (const m of own) {
    options.push({
      id: m.model,
      label: m.model,
      provider: byokVendor(m.vendor)?.label ?? m.vendor,
      usable: true,
      own: true,
    });
  }

  const usable = usableChatChain();
  const reachable = new Set(usable.map((l) => `${l.provider.id}/${l.model}`));

  // Walk the CONFIGURED chain, not just the usable one, so a vendor without a
  // key still appears — as locked, with the way out.
  for (const provider of CHAT_CHAIN) {
    const hasKey = Boolean(process.env[provider.keyEnv]);
    for (const model of providerModels(provider)) {
      const id = `${provider.id}/${model}`;
      options.push({
        id: model,
        label: model,
        provider: provider.id,
        usable: hasKey && reachable.has(id),
        ...(hasKey
          ? {}
          : { reason: "This server has no key for it. Add your own key in Settings → AI." }),
      });
    }
  }

  // With own keys, "Auto" starts on the user's first model; without, on the server's.
  const autoStartsAt = own[0]
    ? `${own[0].vendor}/${own[0].model}`
    : usable[0]
      ? `${usable[0].provider.id}/${usable[0].model}`
      : null;

  return jsonOk({
    options,
    autoStartsAt,
    addKeyHref: MODEL_STORE_PATH,
  } satisfies LokiModelsResponse);
}
