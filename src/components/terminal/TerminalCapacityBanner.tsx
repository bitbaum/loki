"use client";

import { Loader2 } from "lucide-react";
import { agentLabel } from "@/lib/agent-resolution";

export type AgentAvailability = {
  id: string;
  label: string;
  available: boolean;
  availabilityReason?: string;
};

type Props = {
  /** The agent that hit the capacity wall. */
  currentAgent: string;
  /** All agents in fallback order with their availability status. */
  agents: AgentAvailability[];
  /** When the capacity resets, if detected from the error message. */
  resetsAt?: string;
  /** Callback to perform the agent switch. */
  onSwitch: (agent: string) => void;
  /** True while a switch is in progress. */
  switching?: boolean;
};

/**
 * Terminal capacity overlay — hides the vendor error and shows one decision:
 * switch to the next available agent.
 *
 * No menu of agents, no cloud/local puzzle, no vendor error visible.
 * One sentence, one button. The operator confirms; we handle the rest.
 */
export function TerminalCapacityBanner({
  currentAgent,
  agents,
  resetsAt,
  onSwitch,
  switching = false,
}: Props) {
  const currentLabel = agentLabel(currentAgent);
  
  // Find the next available agent in the fallback order
  const nextAgent = agents.find((a) => a.available);
  const allExhausted = !nextAgent;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-terminal p-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        {allExhausted ? (
          <>
            <p className="text-sm text-text-secondary">
              {currentLabel} hit its limit{resetsAt ? ` (resets ${resetsAt})` : ""}.
            </p>
            <p className="text-xs text-text-muted">
              All agents are at capacity. Wait for the reset time or install additional agents.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              {currentLabel} hit its limit{resetsAt ? ` (resets ${resetsAt})` : ""}.
            </p>
            <button
              type="button"
              disabled={switching}
              onClick={() => onSwitch(nextAgent.id)}
              className="ui-btn-primary inline-flex items-center gap-2"
            >
              {switching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Switching to {nextAgent.label}…
                </>
              ) : (
                <>Switch to {nextAgent.label}</>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
