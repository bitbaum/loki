"use client";

import { Check, Loader2, Minus, Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { ExecutorHonestyChip } from "@/components/executor/ExecutorHonestyChip";
import type { ExecutorHonestyLabel } from "@/lib/executor-honesty";
import type { AgentEntry } from "@/components/control/agent-switcher-popover";
import {
  TERMINAL_INPUT_MODES,
  TERMINAL_SOURCES,
  terminalInputHint,
  terminalSourceHint,
  type TerminalInputMode,
  type TerminalSource,
} from "@/config/terminal-modes";
import type { TerminalFontControl } from "@/hooks/use-terminal-font";

export type SheetTab = { id: string; label: string; badge?: string };

/** One tappable row that is either chosen or not. Every choice in this sheet has
 *  the same shape on purpose — a phone sheet where each section invents its own
 *  control is how the old bar ended up five rows tall. */
function OptionRow({
  title,
  detail,
  active,
  disabled,
  busy,
  onSelect,
}: {
  title: React.ReactNode;
  detail?: string;
  active: boolean;
  disabled?: boolean;
  busy?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={active}
      className={cn("ui-sheet-option", active && "ui-sheet-option-active")}
    >
      <span className="min-w-0 flex-1 text-left">
        <span className="ui-sheet-option-title">{title}</span>
        {detail && <span className="ui-sheet-option-detail">{detail}</span>}
      </span>
      {busy ? (
        <Loader2 className="ui-spinner-sm shrink-0" />
      ) : active ? (
        <Check className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
      ) : null}
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="ui-sheet-section">
      <h3 className="ui-sheet-label">{label}</h3>
      {children}
    </section>
  );
}

/**
 * Everything about the session that is not the session.
 *
 * The phone used to carry all of this in the page: a source select, a session
 * select, an agent button, an input-mode select, an honesty chip, a font
 * stepper and a hint paragraph — measured at 331px of controls above a terminal
 * that got four visible lines. None of it is per-second information. It is
 * setup: chosen once, changed rarely, and read never while an agent is working.
 *
 * So it lives here, one tap behind the session name, and the page gives its
 * height back to the thing the operator actually came to watch.
 */
export function TerminalSessionSheet({
  onClose,
  source,
  sources,
  onSourceChange,
  tabs,
  activeTab,
  onSelectTab,
  inputMode,
  onInputModeChange,
  agents,
  activeAgentId,
  onSwitchAgent,
  switchingAgent,
  agentSwitchDisabledReason,
  honesty,
  font,
  columns,
  liveKeys,
  onLiveKeysChange,
  onOpenLoki,
}: {
  onClose: () => void;
  source: TerminalSource;
  sources: TerminalSource[];
  onSourceChange: (source: TerminalSource) => void;
  tabs?: SheetTab[];
  activeTab: string | null;
  onSelectTab?: (id: string) => void;
  inputMode: TerminalInputMode;
  onInputModeChange: (mode: TerminalInputMode) => void;
  agents: AgentEntry[];
  activeAgentId: string | null;
  onSwitchAgent: (agentId: string) => void;
  switchingAgent: boolean;
  agentSwitchDisabledReason: string | null;
  honesty: ExecutorHonestyLabel | null;
  font: TerminalFontControl;
  columns: number | null;
  /** Hand keystrokes to xterm itself instead of the composer. */
  liveKeys: boolean;
  onLiveKeysChange: (value: boolean) => void;
  /** Opens the Loki panel for this project; omitted without a project. */
  onOpenLoki?: () => void;
}) {
  const sourceOptions = TERMINAL_SOURCES.filter((s) => sources.includes(s.id));

  return (
    <Modal onClose={onClose} position="bottom-mobile" padded={false} size="md" className="ui-sheet">
      <div className="ui-sheet-grip" aria-hidden="true" />
      <div className="ui-sheet-body">
        <Section label="Where it runs">
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
        </Section>

        {tabs && onSelectTab && (
          <Section label={tabs.length === 1 ? "Session" : `Sessions · ${tabs.length}`}>
            {tabs.length === 0 && (
              <p className="ui-sheet-empty">
                Nothing is running here yet. Close this and use Start a session.
              </p>
            )}
            {tabs.map((tab) => (
              <OptionRow
                key={tab.id}
                title={tab.label}
                detail={tab.badge ? `running ${tab.badge}` : undefined}
                active={tab.id === activeTab}
                onSelect={() => {
                  onSelectTab(tab.id);
                  onClose();
                }}
              />
            ))}
          </Section>
        )}

        {activeTab && agents.length > 0 && (
          <Section label="Agent">
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
          </Section>
        )}

        {onOpenLoki && (
          // This panel used to be a header button labelled "Loki", beside a
          // conversation view now also called Loki. It is read when stuck, not
          // every minute, so it sits with the session (desktop: "Summary").
          <Section label="Summary">
            <OptionRow
              title="Summary and next steps"
              detail="What this run is doing, what to do next, and a place to ask about it."
              active={false}
              onSelect={onOpenLoki}
            />
          </Section>
        )}

        {activeTab && (
          <Section label="How you talk to it">
            {TERMINAL_INPUT_MODES.map((option) => (
              <OptionRow
                key={option.id}
                title={option.label}
                detail={terminalInputHint(option.id)}
                active={option.id === inputMode}
                onSelect={() => {
                  onInputModeChange(option.id);
                  onClose();
                }}
              />
            ))}
          </Section>
        )}

        <Section label="Display">
          <div className="ui-sheet-row">
            <span className="min-w-0 flex-1 text-sm text-text-secondary">
              Text size
              {columns ? <span className="ui-sheet-option-detail">{columns} columns</span> : null}
            </span>
            <button
              type="button"
              className="ui-term-font-btn"
              onClick={() => font.step(-1)}
              aria-label="Smaller text, more columns"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ui-term-font-btn"
              onClick={() => font.step(1)}
              aria-label="Larger text, fewer columns"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={cn("ui-term-font-reset", font.size === null && "ui-term-font-reset-on")}
              onClick={font.reset}
            >
              Auto
            </button>
          </div>

          {/* The escape hatch for the one thing the composer cannot do: send a
              keystroke the moment it is pressed. Some flows need it — a raw
              password prompt, a TUI that filters as you type. It is off by
              default because on a phone it is also the worse experience, and a
              default that works beats a default that is powerful. */}
          <OptionRow
            title="Live keystrokes"
            detail={
              liveKeys
                ? "Keys go straight to the session as you press them. Tap the screen to focus it first."
                : "Recommended. Type in the composer under the terminal, then Send — no focus fights, no autocorrect."
            }
            active={liveKeys}
            onSelect={() => onLiveKeysChange(!liveKeys)}
          />
        </Section>
      </div>

      <div className="ui-sheet-foot">
        <button type="button" className="ui-btn-secondary w-full" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
