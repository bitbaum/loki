"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ExecutorHonestyChip } from "@/components/executor/ExecutorHonestyChip";
import type { ExecutorHonestyLabel } from "@/lib/executor-honesty";
import type { AgentEntry } from "@/components/control/agent-switcher-popover";
import { TERMINAL_SOURCES, terminalSourceHint, type TerminalSource } from "@/config/terminal-modes";
import { OptionRow, SheetSection } from "./sheet-rows";

export type SheetTab = { id: string; label: string; badge?: string };

/**
 * Everything about WHICH session — what the session name in the phone header
 * opens: the sessions, a new one, where they run and which agent runs this one.
 *
 * The phone used to carry all of this in the page: a source select, a session
 * select, an agent button, an input-mode select, an honesty chip, a font
 * stepper and a hint paragraph — measured at 331px of controls above a terminal
 * that got four visible lines. Then the sessions became a scrolling row of tabs
 * in the header, which pushed "+" off the edge once two were open (owner,
 * 2026-10-19). A chat app names the conversation you are in and lists the rest
 * one tap behind its name; so does this. How the screen LOOKS (text size, live
 * keystrokes, full screen) and Loki's read of the run are the header's "⋮"
 * (TerminalMoreSheet), not here.
 */
export function TerminalSessionSheet({
  onClose,
  source,
  sources,
  onSourceChange,
  tabs,
  activeTab,
  onSelectTab,
  onCloseTab,
  onNewSession,
  agents,
  activeAgentId,
  onSwitchAgent,
  switchingAgent,
  agentSwitchDisabledReason,
  honesty,
}: {
  onClose: () => void;
  source: TerminalSource;
  sources: TerminalSource[];
  onSourceChange: (source: TerminalSource) => void;
  tabs?: SheetTab[];
  activeTab: string | null;
  onSelectTab?: (id: string) => void;
  /** Ends a session: its agent stops; work it saved stays in the project. */
  onCloseTab?: (id: string) => void;
  /** Opens the start-a-session sheet; omitted where nothing can start. */
  onNewSession?: () => void;
  agents: AgentEntry[];
  activeAgentId: string | null;
  onSwitchAgent: (agentId: string) => void;
  switchingAgent: boolean;
  agentSwitchDisabledReason: string | null;
  honesty: ExecutorHonestyLabel | null;
}) {
  // Closing stops a running agent, so the × arms first and a second tap
  // confirms — the strip's rule on desktop. It disarms on its own.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const sourceOptions = TERMINAL_SOURCES.filter((s) => sources.includes(s.id));

  return (
    <Modal
      onClose={onClose}
      position="bottom-mobile"
      padded={false}
      size="md"
      className="ui-sheet"
      labelledBy="session-sheet-title"
    >
      <div className="ui-sheet-grip" aria-hidden="true" />
      <div className="ui-sheet-body">
        <h2 id="session-sheet-title" className="sr-only">
          Sessions
        </h2>
        {tabs && onSelectTab && (
          <SheetSection label={tabs.length > 1 ? `Sessions · ${tabs.length}` : "Session"}>
            {tabs.length === 0 && !onNewSession && (
              <p className="ui-sheet-empty">Nothing is running here yet.</p>
            )}
            {tabs.map((tab) => (
              <div key={tab.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <OptionRow
                    title={tab.label}
                    detail={tab.badge ? `running ${tab.badge}` : undefined}
                    active={tab.id === activeTab}
                    onSelect={() => {
                      onSelectTab(tab.id);
                      onClose();
                    }}
                  />
                </div>
                {onCloseTab &&
                  (armed === tab.id ? (
                    <button
                      type="button"
                      className="ui-btn-danger min-h-11 shrink-0"
                      onClick={() => {
                        setArmed(null);
                        onCloseTab(tab.id);
                      }}
                    >
                      Close?
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ui-term-mhead-icon"
                      onClick={() => setArmed(tab.id)}
                      aria-label={`Close ${tab.label}`}
                      title="Close this session"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ))}
              </div>
            ))}
            {onNewSession && (
              <button
                type="button"
                className="ui-sheet-option"
                onClick={() => {
                  onClose();
                  onNewSession();
                }}
              >
                <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="ui-sheet-option-title min-w-0 flex-1 text-left">New session</span>
              </button>
            )}
          </SheetSection>
        )}

        <SheetSection label="Where it runs">
          {sourceOptions.map((option) => (
            <OptionRow
              key={option.id}
              title={option.label}
              detail={terminalSourceHint(option.id)}
              active={option.id === source}
              onSelect={() => {
                onSourceChange(option.id);
                onClose();
              }}
            />
          ))}
          <ExecutorHonestyChip honesty={honesty} className="self-start" />
        </SheetSection>

        {activeTab && agents.length > 0 && (
          <SheetSection label="Agent">
            {agentSwitchDisabledReason && (
              <p className="ui-sheet-empty">{agentSwitchDisabledReason}</p>
            )}
            {!agentSwitchDisabledReason && (
              <p className="ui-sheet-empty">
                Switching quits the CLI running in this session and relaunches the new one.
              </p>
            )}
            {agents.map((agent) => (
              <OptionRow
                key={agent.id}
                title={agent.label}
                active={agent.id === activeAgentId}
                disabled={Boolean(agentSwitchDisabledReason) || switchingAgent}
                busy={switchingAgent && agent.id !== activeAgentId}
                onSelect={() => {
                  if (agent.id !== activeAgentId) onSwitchAgent(agent.id);
                }}
              />
            ))}
          </SheetSection>
        )}
      </div>

      <div className="ui-sheet-foot">
        <button type="button" className="ui-btn-secondary w-full" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
