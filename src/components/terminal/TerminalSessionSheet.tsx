"use client";

import { useEffect, useState } from "react";
import { Bot, Check, Cloud, Laptop, Plus, SquareTerminal, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import type { AgentEntry } from "@/components/control/agent-switcher-popover";
import { TERMINAL_SOURCES, type TerminalSource } from "@/config/terminal-modes";
import { SESSION_STATUS_WORDS, type SessionStatus } from "@/lib/terminal-session-status";

export type SheetTab = {
  id: string;
  label: string;
  badge?: string;
  status?: SessionStatus | null;
};

const SOURCE_ICON: Record<TerminalSource, typeof Cloud> = {
  cloud: Cloud,
  machine: Laptop,
  shell: SquareTerminal,
};

/** Colour only where acting on it helps (design reset rule 8): a session
 *  waiting on you. Finished, working and open are words. */
const STATUS_DOT: Partial<Record<SessionStatus, "warning">> = {
  "needs-you": "warning",
};

/**
 * Everything about WHICH session — what the session name in the phone header
 * opens: the sessions, a new one, where they run and which agent runs this one.
 *
 * A chat app names the conversation you are in and lists the rest one tap
 * behind its name; so does this. Three short lists of rows, a check on the
 * one in use, nothing to read: it was capital-letter section labels, a hint
 * sentence under every place it could run, a status chip, a paragraph about
 * relaunching the CLI and a Done button (owner, 2026-10-21). How the screen
 * LOOKS (text size, live keystrokes, full screen) and Loki's read of the run
 * are the header's "⋮" (TerminalMoreSheet), not here.
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
  onNewShell,
  agents,
  activeAgentId,
  onSwitchAgent,
  switchingAgent,
  agentSwitchDisabledReason,
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
  /** Opens a plain shell on this builder; omitted for anyone it is not for. */
  onNewShell?: () => void;
  agents: AgentEntry[];
  activeAgentId: string | null;
  onSwitchAgent: (agentId: string) => void;
  switchingAgent: boolean;
  agentSwitchDisabledReason: string | null;
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
  const check = <Check className="h-5 w-5 text-text-primary" aria-label="In use" />;

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
          <Section title="Open now">
            <List>
              {tabs.map((tab) => (
                <ListRow
                  key={tab.id}
                  icon={SquareTerminal}
                  title={tab.label}
                  secondary={
                    [tab.badge, tab.status ? SESSION_STATUS_WORDS[tab.status] : null]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  status={tab.status ? STATUS_DOT[tab.status] : undefined}
                  onClick={() => {
                    onSelectTab(tab.id);
                    onClose();
                  }}
                  trailing={tab.id === activeTab ? check : undefined}
                  menu={
                    onCloseTab ? (
                      armed === tab.id ? (
                        <button
                          type="button"
                          className="ui-btn-danger min-h-11"
                          onClick={() => {
                            setArmed(null);
                            onCloseTab(tab.id);
                          }}
                        >
                          End it?
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ui-btn-icon min-h-11 min-w-11"
                          onClick={() => setArmed(tab.id)}
                          aria-label={`End ${tab.label}`}
                          title="End this session"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )
                    ) : undefined
                  }
                />
              ))}
              {onNewSession && (
                <ListRow
                  icon={Plus}
                  title="New session"
                  onClick={() => {
                    onClose();
                    onNewSession();
                  }}
                />
              )}
              {onNewShell && (
                <ListRow
                  icon={SquareTerminal}
                  title="Plain shell"
                  secondary="A command line on the server. No project, no agent."
                  label="Open a plain shell"
                  onClick={() => {
                    onClose();
                    onNewShell();
                  }}
                />
              )}
            </List>
            {tabs.length === 0 && !onNewSession && !onNewShell && (
              <p className="ui-sheet-empty">Nothing is open here yet.</p>
            )}
          </Section>
        )}

        {sourceOptions.length > 1 && (
          <Section title="Runs on">
            <List>
              {sourceOptions.map((option) => (
                <ListRow
                  key={option.id}
                  icon={SOURCE_ICON[option.id]}
                  title={option.label}
                  onClick={() => {
                    onSourceChange(option.id);
                    onClose();
                  }}
                  trailing={option.id === source ? check : undefined}
                />
              ))}
            </List>
          </Section>
        )}

        {activeTab && agents.length > 0 && (
          <Section title="Agent">
            <List>
              {agents.map((agent) => (
                <ListRow
                  key={agent.id}
                  icon={Bot}
                  title={agent.label}
                  secondary={
                    agent.id === activeAgentId && agentSwitchDisabledReason
                      ? agentSwitchDisabledReason
                      : switchingAgent && agent.id !== activeAgentId
                        ? "Switching…"
                        : undefined
                  }
                  onClick={
                    agentSwitchDisabledReason || switchingAgent || agent.id === activeAgentId
                      ? undefined
                      : () => onSwitchAgent(agent.id)
                  }
                  trailing={agent.id === activeAgentId ? check : undefined}
                />
              ))}
            </List>
          </Section>
        )}
      </div>
    </Modal>
  );
}
