import { providerChoiceFor, type ProviderChoiceProject } from "@/lib/provider-choice";
import { routeAroundSpent } from "@/lib/provider-switch";
import type { AgentReroute } from "@/lib/agent-reroute";

export { agentRerouteSentence, type AgentReroute } from "@/lib/agent-reroute";

/**
 * The agent a dispatch nobody pinned should start: the project's own, unless
 * Loki has just watched it refuse for capacity and another agent can answer.
 *
 * Kickoff, Feedback's Implement and the retry already asked this; a task typed
 * in Loki's chat did not. On 2026-11-12 the orangecat project's agent was
 * Grok, whose Grok Build balance was used up ("402 Payment Required: Grok Build
 * usage balance exhausted"), and every chat message to it failed in fifteen
 * seconds while Claude Code, on the same builder, answered.
 *
 * Not a preference change: the next dispatch after the balance is topped up
 * goes back to the project's agent. Anything unreadable keeps the preferred
 * agent; a possible run beats a certain none.
 */
export async function agentAvoidingSpent(
  userId: string,
  project: ProviderChoiceProject,
  preferred: string,
): Promise<{ agent: string; rerouted: AgentReroute | null }> {
  const choice = await providerChoiceFor(userId, project, { current: preferred }).catch(() => null);
  if (!choice) return { agent: preferred, rerouted: null };
  const decided = routeAroundSpent({
    preferred,
    spent: choice.spent,
    options: choice.options,
    notInstalled: choice.currentMissing,
  });
  if (!decided.rerouted || decided.agent === preferred) return { agent: preferred, rerouted: null };
  return {
    agent: decided.agent,
    rerouted: {
      from: preferred,
      to: decided.agent,
      because: decided.rerouted.because,
      why: decided.rerouted.why,
    },
  };
}
