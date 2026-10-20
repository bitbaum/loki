import type { VendorId } from "@/config/model-vendors";

/**
 * Which of a person's own keys can drive the agent CLIs in their private
 * builder, and the variable each CLI reads it from. SSOT for Settings → Your
 * engine ("also for building"), for the box script that writes a tenant's
 * unit env (scripts/write-tenant-engines.ts), and for the agent environment
 * allowlist (lib/agent-execution/agent-env.ts ENGINE_KEY_NAMES).
 *
 * A key is one of three engines (docs/master-plan-2026-10.md §2); the other
 * two — a subscription signed in with the CLI's own `/login`, and a Loki
 * plan — never pass through here. A vendor not listed (OpenRouter, Groq, a
 * custom host) powers Loki's chat only: no agent CLI builds on it.
 */
export const BUILD_ENGINES: ReadonlyArray<{
  vendor: VendorId;
  /** The variable the CLI reads. */
  env: string;
  /** The CLI it drives, in the person's words. */
  agent: string;
}> = [
  { vendor: "anthropic", env: "ANTHROPIC_API_KEY", agent: "Claude Code" },
  { vendor: "openai", env: "OPENAI_API_KEY", agent: "Codex" },
  { vendor: "xai", env: "XAI_API_KEY", agent: "Grok" },
  { vendor: "google", env: "GEMINI_API_KEY", agent: "Gemini CLI" },
];

export function buildEngineFor(vendor: string): (typeof BUILD_ENGINES)[number] | null {
  return BUILD_ENGINES.find((e) => e.vendor === vendor) ?? null;
}
