import type { AgentSwitch } from "./AttentionBar";
import type { ProjectState } from "@/lib/control-types";

/** Most capable first — the order "Use … instead" offers them in. */
const PREFERRED = ["claude", "codex", "cursor", "gemini", "grok"];

/**
 * The agent to offer when the project's agent is not installed on its
 * builder: the first one that builder reported having, other than the one
 * that just failed (named at the start of the error, "Grok is not installed
 * on …"). A builder that has not reported its roster is the cloud builder's
 * floor — Claude, which every box runs — or nothing for a computer we know
 * nothing about, rather than a guess that fails the same way.
 */
export function agentToSwitchTo(
  project: Pick<ProjectState, "builderAgents" | "builderChannel"> | undefined,
  error: string,
  catalog: readonly { id: string; label: string }[],
): AgentSwitch | null {
  if (!project) return null;
  const installed =
    project.builderAgents ?? (project.builderChannel === "local" ? null : ["claude"]);
  if (!installed) return null;
  const failed = catalog.find((a) => error.toLowerCase().startsWith(a.label.toLowerCase()));
  for (const id of PREFERRED) {
    if (id === failed?.id || !installed.includes(id)) continue;
    const entry = catalog.find((a) => a.id === id);
    if (entry) return { id, label: entry.label };
  }
  return null;
}
