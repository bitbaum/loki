import type { AdapterId, OrchestrationSeam } from "./contract";
import { ADAPTER_DEFINITIONS } from "./adapters";
import { claudeOrchestrationAdapter } from "./claude-seam";
import { closeRunFromSession } from "./close-from-session";

// Session handoffs share one model-agnostic close contract. Adapter-specific
// lifecycle collection and prompt enrichment remain on their own seams.
function handoffSeam(id: AdapterId): OrchestrationSeam {
  const definition = ADAPTER_DEFINITIONS[id];
  return {
    id,
    label: definition.label,
    capabilities: definition.capabilities,
    closeRunFromSession,
  };
}

// Registered orchestration seams. Every adapter that advertises
// sessionHandoff must close a delivered run from the standard handoff; leaving
// one out makes its completed work remain “Working” forever.
// node-only (the claude seam pulls in fs) — do NOT re-export via the
// orchestration barrel; import `adapterFor` directly from node handlers.
const SEAMS: Partial<Record<AdapterId, OrchestrationSeam>> = {
  claude: claudeOrchestrationAdapter,
  codex: handoffSeam("codex"),
  openclaw: handoffSeam("openclaw"),
  gemini: handoffSeam("gemini"),
  grok: handoffSeam("grok"),
  cursor: handoffSeam("cursor"),
};

/**
 * Resolve the orchestration seam for an adapter, or `undefined` when none is
 * registered. Call sites use `adapterFor(id)?.hook?.(…) ?? <neutral fallback>`
 * so an absent adapter/hook reproduces today's neutral behavior.
 */
export function adapterFor(id: AdapterId): OrchestrationSeam | undefined {
  return SEAMS[id];
}
