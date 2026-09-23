"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TERMINAL_INPUT_MODES,
  TERMINAL_SOURCES,
  terminalInputHint,
  type TerminalInputMode,
  type TerminalSource,
} from "@/config/terminal-modes";
import { AgentSwitcherPopover, type AgentEntry } from "@/components/control/agent-switcher-popover";
import { ExecutorHonestyChip } from "@/components/executor/ExecutorHonestyChip";
import type { ExecutorHonestyLabel } from "@/lib/executor-honesty";

/** One segmented control. Kept local — three call sites in this file, and the
 *  chip classes it composes are already the design-system SSOT. */
function Segment<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; hint: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          title={option.hint}
          aria-pressed={option.id === value}
          className={option.id === value ? "ui-chip-toggle-active" : "ui-chip-toggle"}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Source bar — *which* sessions the tab strip below is listing.
 *
 * Split from the session controls deliberately. Source is a scope: it decides
 * what tabs exist, so it belongs above the strip. Agent and input mode act on
 * the one tab you have selected, so they belong below it. Rendering all of them
 * in a single row put "switch the agent in this tab" above the tab picker,
 * which reads as a global setting and is not one.
 */
export function TerminalSourceBar({
  source,
  onSourceChange,
  sources,
  honesty,
}: {
  source: TerminalSource;
  onSourceChange: (source: TerminalSource) => void;
  /** Which sources this deployment can actually offer. */
  sources: TerminalSource[];
  /** null when there is nothing worth saying — a healthy local runtime needs no
   *  chip, and the bar must not invent one. */
  honesty: ExecutorHonestyLabel | null;
}) {
  const sourceOptions = TERMINAL_SOURCES.filter((s) => sources.includes(s.id));
  if (sourceOptions.length <= 1 && !honesty) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {sourceOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-micro-label">Sessions and direct starts</span>
          <Segment
            options={sourceOptions}
            value={source}
            onChange={onSourceChange}
            label="Sessions and direct starts"
          />
        </div>
      )}
      <ExecutorHonestyChip honesty={honesty} />
    </div>
  );
}

/**
 * Session bar — the switches that act on the selected tab.
 *
 * What made the old terminal feel disconnected was not missing capability: you
 * could already switch agent (on Control, inside a project card), dispatch a
 * composed prompt (on Control), speak a task (a floating mic), and pick a
 * prompt template (on /prompts). All four acted on the session you were staring
 * at on /terminal, and none of them were reachable from it.
 *
 * Agent switching is real and destructive — it quits the running CLI and
 * launches another — so it stays behind the same popover Control uses,
 * including its availability rules, rather than becoming a bare segment.
 */
export function TerminalSessionBar({
  inputMode,
  onInputModeChange,
  agents,
  activeAgentId,
  onSwitchAgent,
  switchingAgent,
  agentSwitchDisabledReason,
}: {
  inputMode: TerminalInputMode;
  onInputModeChange: (mode: TerminalInputMode) => void;
  agents: AgentEntry[];
  activeAgentId: string | null;
  onSwitchAgent: (agentId: string) => void;
  switchingAgent: boolean;
  /** Non-null when switching cannot work right now — shown as the button title. */
  agentSwitchDisabledReason: string | null;
}) {
  const [agentOpen, setAgentOpen] = useState(false);
  const activeAgent = agents.find((a) => a.id === activeAgentId);
  const agentLabel = activeAgent?.label ?? "Agent";
  const canSwitchAgent = agents.length > 0 && !agentSwitchDisabledReason;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => canSwitchAgent && setAgentOpen((open) => !open)}
            disabled={!canSwitchAgent || switchingAgent}
            title={agentSwitchDisabledReason ?? "Switch the agent running in this tab"}
            aria-haspopup="menu"
            aria-expanded={agentOpen}
            className={cn(
              "ui-chip-toggle inline-flex items-center gap-1",
              !canSwitchAgent && "cursor-not-allowed opacity-50",
            )}
          >
            {switchingAgent ? <Loader2 className="ui-spinner-sm" /> : null}
            {agentLabel}
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
          {agentOpen && (
            <AgentSwitcherPopover
              agents={agents}
              activeAgentId={activeAgentId ?? ""}
              onSwitch={(id) => {
                if (id) onSwitchAgent(id);
              }}
              onClose={() => setAgentOpen(false)}
            />
          )}
        </div>

        <Segment
          options={TERMINAL_INPUT_MODES}
          value={inputMode}
          onChange={onInputModeChange}
          label="Input mode"
        />
      </div>

      {/* One line of consequence for the selected input mode. Replaces the
          permanent yellow callout that used to sit above every terminal
          repeating the same paragraph regardless of what you were doing. */}
      <p className="text-micro leading-snug text-text-muted">{terminalInputHint(inputMode)}</p>
    </div>
  );
}
