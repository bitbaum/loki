"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Cpu } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { CLAUDE_MODES, commandOfKind } from "@/config/agent-commands";
import { CYCLE_MODE_KEY, modelLabel } from "@/lib/claude-transcript";

/**
 * Which model is answering, and what it may do without asking — in the box's
 * tool row, where the Claude app shows them.
 *
 * It replaced a chip that said "Auto" (and "Switched…" after a tap) with no
 * way to learn what either meant, while the model was not shown anywhere
 * (operator, 2026-10-15: "I have no idea what model is being used. I don't
 * know what that auto is"). The chip names both; pressing it explains them in
 * plain words and offers the three things a person can change — the model,
 * how hard it thinks, and the mode — each as the agent's own command or key.
 *
 * Both facts are READ from Claude Code's log (the model on its last answer,
 * the mode on your last message), never assumed. Changing the mode is Shift+Tab
 * because the order of modes differs between Claude Code versions; the new
 * one is written down with your next message, and the sheet says so.
 */
export function SessionInfo({
  model,
  mode,
  lastMessageId,
  onKey,
  agent = "claude",
}: {
  /** The model id on the newest answer, or null before one names it. */
  model: string | null;
  mode: { id: string; label: string } | null;
  lastMessageId: string | null;
  onKey: (bytes: string) => void | Promise<void>;
  agent?: string;
}) {
  const [open, setOpen] = useState(false);
  const [cycledAfter, setCycledAfter] = useState<string | null | undefined>(undefined);
  const pending = cycledAfter !== undefined && cycledAfter === lastMessageId;
  if (!model && !mode) return null;

  const name = model ? modelLabel(model) : null;
  const chip = [name, pending ? "mode changing…" : mode?.label].filter(Boolean).join(" · ");
  const type = (text: string) => {
    void onKey(`${text}\r`);
    setOpen(false);
  };
  const modelCmd = commandOfKind(agent, "model");
  const effortCmd = commandOfKind(agent, "effort");
  const agentName = agent === "claude" ? "Claude Code" : "The agent";

  return (
    <>
      <button
        type="button"
        className="ui-claude-mode"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Model and mode: ${chip}. Explain and change`}
      >
        <Cpu className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{chip}</span>
      </button>
      {open &&
        createPortal(
          <Modal
            onClose={() => setOpen(false)}
            position="bottom-mobile"
            size="sm"
            labelledBy="session-info-title"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="session-info-title" className="ui-page-subtitle">
                This session
              </h2>
              <button type="button" className="ui-btn-ghost ui-tap" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <section className="ui-session-info-row">
              <div className="min-w-0 flex-1">
                <p className="ui-micro-label">Model</p>
                <p className="text-sm text-text-primary">
                  {name ?? "Not known yet"}
                  {model && name !== model && (
                    <span className="ml-1.5 font-mono text-micro text-text-muted">{model}</span>
                  )}
                </p>
                <p className="text-xs text-text-secondary">
                  {name
                    ? "The model that wrote the agent's last answer."
                    : "It is named on the agent's next answer."}
                </p>
              </div>
              {modelCmd && (
                <button
                  type="button"
                  className="ui-btn-secondary"
                  onClick={() => type(modelCmd.text)}
                >
                  Change
                </button>
              )}
            </section>

            {effortCmd && (
              <section className="ui-session-info-row">
                <div className="min-w-0 flex-1">
                  <p className="ui-micro-label">Effort</p>
                  <p className="text-xs text-text-secondary">
                    How long it thinks before answering. Higher is slower, and better for planning
                    and hard problems; {agentName} shows the levels when you press Set.
                  </p>
                </div>
                <button
                  type="button"
                  className="ui-btn-secondary"
                  onClick={() => type(effortCmd.text)}
                >
                  Set
                </button>
              </section>
            )}

            {mode && (
              <section className="ui-session-info-row">
                <div className="min-w-0 flex-1">
                  <p className="ui-micro-label">Mode</p>
                  <p className="text-sm text-text-primary">{mode.label}</p>
                  <p className="text-xs text-text-secondary">
                    {pending
                      ? "Changing — the new mode is shown with your next message."
                      : (CLAUDE_MODES[mode.id]?.means ?? "Claude Code's own mode.")}
                  </p>
                </div>
                <button
                  type="button"
                  className="ui-btn-secondary"
                  onClick={() => {
                    void onKey(CYCLE_MODE_KEY);
                    setCycledAfter(lastMessageId);
                  }}
                >
                  Next mode
                </button>
              </section>
            )}

            <details className="text-xs text-text-secondary">
              <summary className="cursor-pointer text-text-primary">What the modes mean</summary>
              <ul className="mt-2 space-y-1.5">
                {Object.entries(CLAUDE_MODES).map(([id, m]) => (
                  <li key={id}>
                    <span className="font-medium text-text-primary">{m.label}</span> — {m.means}
                  </li>
                ))}
              </ul>
            </details>
          </Modal>,
          document.body,
        )}
    </>
  );
}
