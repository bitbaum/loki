/**
 * Agents offered when the current builder is quota-dead.
 *
 * SSOT for the Terminal Loki rail (and any later Needs-you chooser). Hermes is
 * not in this list — it is a hosted fallback, not a one-tap swap. Antigravity
 * is Gemini's product name; the orchestration id stays `gemini`.
 */
import { AGENT_LABELS } from "@/lib/agent-labels";

export const QUOTA_ALTERNATIVE_AGENTS = [
  { id: "grok", label: AGENT_LABELS.grok },
  { id: "cursor", label: AGENT_LABELS.cursor },
  { id: "gemini", label: "Antigravity" },
] as const;

export type QuotaAlternativeId = (typeof QUOTA_ALTERNATIVE_AGENTS)[number]["id"];
export type QuotaAlternative = { id: QuotaAlternativeId; label: string };
