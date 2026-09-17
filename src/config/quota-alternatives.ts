/**
 * Agents offered when the current builder is quota-dead / inject-no-generate.
 *
 * SSOT for the *membership and labels* of every provider chooser — the Terminal
 * Loki rail, the Needs-you row on Feedback, and the Control inbox. The ORDER a
 * chooser offers them in is not here: it is the operator's preferred order
 * (`user_preferences.agent_order`), defaulting to `AGENT_FALLBACK_ORDER`. This
 * list is derived from that default so the two can never disagree about WHICH
 * agents exist — a chooser that offered an agent the reroute policy had never
 * heard of was how "try next provider" and "auto-reroute" ended up disagreeing.
 *
 * Hermes is not in this list — it is a hosted fallback, not a one-tap swap.
 * Antigravity is Gemini's product name; the orchestration id stays `gemini`.
 */
import { AGENT_LABELS, type AnyAgentId } from "@/lib/agent-labels";
import { AGENT_FALLBACK_ORDER } from "@/lib/agent-resolution";

/**
 * Names the vendor puts on the product, where they differ from the agent id's
 * generic label. `AGENT_LABELS.gemini` is "Gemini" (the model); the thing an
 * operator installs and switches to is called Antigravity.
 */
const PRODUCT_LABELS: Partial<Record<AnyAgentId, string>> = {
  claude: "Claude Code",
  gemini: "Antigravity",
};

export type QuotaAlternativeId = (typeof AGENT_FALLBACK_ORDER)[number];
export type QuotaAlternative = { id: QuotaAlternativeId; label: string };

export const QUOTA_ALTERNATIVE_AGENTS: readonly QuotaAlternative[] = AGENT_FALLBACK_ORDER.map(
  (id) => ({ id, label: PRODUCT_LABELS[id] ?? AGENT_LABELS[id] }),
);

export const QUOTA_ALTERNATIVE_IDS: readonly QuotaAlternativeId[] = AGENT_FALLBACK_ORDER;

export function isQuotaAlternativeId(value: unknown): value is QuotaAlternativeId {
  return typeof value === "string" && (QUOTA_ALTERNATIVE_IDS as readonly string[]).includes(value);
}

/** The chooser's display name for an agent id — never the bare id. */
export function providerLabel(id: string): string {
  return (
    QUOTA_ALTERNATIVE_AGENTS.find((a) => a.id === id)?.label ?? AGENT_LABELS[id as AnyAgentId] ?? id
  );
}
