"use client";

import { useRef, useEffect } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One agent-selection surface. Availability is honoured here exactly as it is in
 * the launch modal and the chip picker: an agent the connected computer did not
 * report as installed is shown DISABLED with its reason — never a fake-enabled
 * row that quits the current CLI and launches a binary that isn't there.
 */
export type AgentEntry = {
  id: string;
  label: string;
  /** From the runner capability report. `undefined` = unknown (treated as usable). */
  available?: boolean;
  availabilityReason?: string;
  /**
   * Short suffix for a disabled row. Defaults to "not installed", which is the
   * only reason this popover knew about when it was the agent switcher alone.
   * The provider chooser also disables agents that ARE installed and merely out
   * of quota, and labelling those "(not installed)" was a false claim sitting
   * directly above a sentence that said otherwise.
   */
  unavailableNote?: string;
  modelSuggestions?: string[];
};

export function AgentSwitcherPopover({
  agents,
  activeAgentId,
  onSwitch,
  onClose,
  title = "Switch agent",
  hint = "Quits the current CLI and launches the new one — no /quit in terminal.",
}: {
  agents: AgentEntry[];
  activeAgentId: string;
  onSwitch: (agentId: string | null) => void;
  onClose: () => void;
  /** Heading. The default describes a LIVE tab swap; the provider chooser on a
   *  queued run is not swapping anything yet, so it says what it actually does. */
  title?: string;
  hint?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-50 mt-1.5 min-w-[130px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border-default bg-surface-overlay py-1.5 shadow-card"
    >
      <p className="px-3 pb-1 pt-0.5 text-micro uppercase tracking-wide text-text-muted">{title}</p>
      <p className="px-3 pb-1.5 text-micro leading-snug text-text-muted">{hint}</p>
      {agents.map((agent) => {
        const isActive = agent.id === activeAgentId;
        // undefined availability = unknown (no runner report) → treat as usable;
        // only an explicit false disables the row.
        const unavailable = agent.available === false;
        return (
          <button
            key={agent.id}
            type="button"
            disabled={unavailable}
            title={unavailable ? agent.availabilityReason : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (unavailable) return;
              onSwitch(isActive ? null : agent.id);
              onClose();
            }}
            className={cn(
              "flex ui-tap w-full flex-col justify-center px-3 py-1.5 text-xs transition-colors",
              unavailable
                ? "cursor-not-allowed text-text-muted opacity-60"
                : "hover:bg-surface-raised",
              !unavailable && (isActive ? "text-accent-text" : "text-text-secondary"),
            )}
          >
            <span className="flex items-center gap-2">
              {isActive && <Check className="h-3 w-3 shrink-0" />}
              <span className={cn(isActive && "font-medium", !isActive && !unavailable && "pl-5")}>
                {agent.label}
                {unavailable && ` (${agent.unavailableNote ?? "not installed"})`}
              </span>
            </span>
            {unavailable && agent.availabilityReason && (
              <span className="pl-5 text-micro leading-snug text-text-muted">
                {agent.availabilityReason}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
