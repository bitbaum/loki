/**
 * Agents offered when the current builder is quota-dead.
 *
 * SSOT for the Terminal Loki rail (and any later Needs-you chooser). Hermes is
 * not in this list — it is a hosted fallback, not a one-tap swap. Antigravity
 * is Gemini's product name; the orchestration id stays `gemini`.
 * Cato 2026-09-16: include every coding agent we use (Claude Code, Codex,
 * Cursor, Grok, Antigravity) — never a Cursor/Grok-only chooser.
 */
import { AGENT_LABELS } from "@/lib/agent-labels";

export const QUOTA_ALTERNATIVE_AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: AGENT_LABELS.codex },
  { id: "cursor", label: AGENT_LABELS.cursor },
  { id: "grok", label: AGENT_LABELS.grok },
  { id: "gemini", label: "Antigravity" },
] as const;

export type QuotaAlternativeId = (typeof QUOTA_ALTERNATIVE_AGENTS)[number]["id"];
export type QuotaAlternative = { id: QuotaAlternativeId; label: string };
