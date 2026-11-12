import { providerLabel } from "@/config/quota-alternatives";
import type { RerouteWhy } from "@/lib/provider-switch";

/** A dispatch that went to another agent than the project's (lib/dispatch-agent-route). */
export type AgentReroute = { from: string; to: string; because: string; why: RerouteWhy };

/** One sentence for the thread: which agent took the task, and why. */
export function agentRerouteSentence(r: AgentReroute): string {
  const from = providerLabel(r.from);
  const to = providerLabel(r.to);
  return r.why === "not-installed"
    ? `${from} cannot start on this builder, so ${to} took this one. The project's agent is unchanged.`
    : `${from} has run out of usage, so ${to} took this one. The project's agent is unchanged; top up ${from} or switch the project to keep it off.`;
}
