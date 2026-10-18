"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Cpu } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { CLAUDE_EFFORTS, CLAUDE_MODES, commandOfKind, commandsFor } from "@/config/agent-commands";
import { CYCLE_MODE_KEY, modelLabel } from "@/lib/claude-transcript";
import { cn } from "@/lib/utils";

/**
 * Which model is answering, how hard it thinks, and what it may do without
 * asking — in the box's tool row, where the Claude app shows them.
 *
 * All three are READ from Claude Code's log (the model and effort on its last
 * answer, the mode on your last message), never assumed.
 *
 * Changing them is done HERE, with the choice visible. The sheet used to
 * offer "Change" and "Set", which typed `/model` and `/effort` into the
 * terminal and closed: Claude Code then drew its picker in the terminal view,
 * behind the conversation the person was looking at, and nothing on their
 * screen moved (owner, 2026-10-18: "fix the Change button and the Set button
 * so they respond when clicked"). Now each row lists its choices; a tap sends
 * the agent's own command with the choice named (`/model sonnet`,
 * `/effort high`), the sheet stays open and says what is changing, and the
 * row settles when the log names the new value. The mode is still Shift+Tab,
 * because the order of modes differs between Claude Code versions.
 */
export function SessionInfo({
  model,
  effort = null,
  mode,
  lastMessageId,
  onKey,
  agent = "claude",
}: {
  /** The model id on the newest answer, or null before one names it. */
  model: string | null;
  /** How hard the newest answer thought, when the log says. */
  effort?: { id: string; label: string } | null;
  mode: { id: string; label: string } | null;
  lastMessageId: string | null;
  onKey: (bytes: string) => void | Promise<void>;
  agent?: string;
}) {
  const [open, setOpen] = useState(false);
  const [cycledAfter, setCycledAfter] = useState<string | null | undefined>(undefined);
  // What was asked for: the alias ("sonnet") or level ("high"). It reads as
  // pending until the log names it — derived, so nothing syncs state.
  const [askedModel, setAskedModel] = useState<string | null>(null);
  const [askedEffort, setAskedEffort] = useState<string | null>(null);
  const wantModel =
    askedModel && !(model ?? "").toLowerCase().includes(askedModel) ? askedModel : null;
  const wantEffort = askedEffort && effort?.id !== askedEffort ? askedEffort : null;

  const modePending = cycledAfter !== undefined && cycledAfter === lastMessageId;
  if (!model && !mode) return null;

  const name = model ? modelLabel(model) : null;
  const models = commandsFor(agent).filter(
    (c) => c.kind === "model" && /^\/model\s+\S+$/.test(c.text),
  );
  const modelListCmd = commandOfKind(agent, "model");
  const effortCmd = commandOfKind(agent, "effort");
  const agentName = agent === "claude" ? "Claude Code" : "The agent";
  const type = (text: string) => void onKey(`${text}\r`);

  const chipModel = wantModel ? `${cap(wantModel)}…` : (name ?? "Model?");
  const chip = [chipModel, modePending ? "mode changing…" : mode?.label]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <button
        type="button"
        className="ui-box-chip"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Model and mode: ${chip}. Explain and change`}
      >
        <Cpu className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{chip}</span>
      </button>
      {open &&
        createPortal(
          <Modal
            onClose={() => setOpen(false)}
            position="bottom-mobile"
            padded={false}
            size="md"
            className="ui-sheet"
            labelledBy="session-info-title"
          >
            <div className="ui-sheet-grip" aria-hidden="true" />
            <div className="ui-sheet-body">
              <h2 id="session-info-title" className="sr-only">
                This session
              </h2>

              <section className="ui-sheet-section">
                <h3 className="ui-sheet-label">Model</h3>
                <p className="ui-sheet-value">
                  {wantModel ? `Switching to ${cap(wantModel)}` : (name ?? "Not known yet")}
                  {!wantModel && model && name !== model && (
                    <span className="ml-1.5 font-mono text-micro text-text-muted">{model}</span>
                  )}
                </p>
                <p className="ui-sheet-hint">
                  {wantModel
                    ? "It is named on the agent's next answer."
                    : name
                      ? "The model that wrote the agent's last answer."
                      : "It is named on the agent's next answer."}
                </p>
                {models.length > 0 ? (
                  <Choices
                    label="Change the model"
                    options={models.map((c) => ({
                      id: c.text.split(/\s+/)[1]!.toLowerCase(),
                      label: c.label.replace(/^Use\s+/, ""),
                      hint: c.hint,
                    }))}
                    current={model?.toLowerCase() ?? null}
                    pending={wantModel}
                    onPick={(id) => {
                      type(`${modelListCmd?.text.split(/\s+/)[0] ?? "/model"} ${id}`);
                      setAskedModel(id);
                    }}
                  />
                ) : (
                  modelListCmd && (
                    <TerminalOnly
                      verb="Choose a model"
                      agentName={agentName}
                      onClick={() => type(modelListCmd.text)}
                    />
                  )
                )}
              </section>

              {effortCmd && (
                <section className="ui-sheet-section">
                  <h3 className="ui-sheet-label">Effort</h3>
                  <p className="ui-sheet-value">
                    {wantEffort
                      ? `Switching to ${CLAUDE_EFFORTS[wantEffort] ?? wantEffort}`
                      : (effort?.label ?? "Not known yet")}
                  </p>
                  <p className="ui-sheet-hint">
                    How long it thinks before answering. Higher is slower, and better for planning
                    and hard problems.
                    {wantEffort ? " It is named on the agent's next answer." : ""}
                  </p>
                  <Choices
                    label="Change the effort"
                    options={Object.entries(CLAUDE_EFFORTS).map(([id, label]) => ({
                      id,
                      label: label.replace(/\s+effort$/i, ""),
                      hint: null,
                    }))}
                    current={effort?.id ?? null}
                    pending={wantEffort}
                    onPick={(id) => {
                      type(`${effortCmd.text.split(/\s+/)[0]} ${id}`);
                      setAskedEffort(id);
                    }}
                  />
                </section>
              )}

              {mode && (
                <section className="ui-sheet-section">
                  <h3 className="ui-sheet-label">Mode</h3>
                  <div className="ui-sheet-row">
                    <div className="min-w-0 flex-1">
                      <p className="ui-sheet-value">{mode.label}</p>
                      <p className="ui-sheet-hint">
                        {modePending
                          ? "Changing — the new mode is shown with your next message."
                          : (CLAUDE_MODES[mode.id]?.means ?? `${agentName}'s own mode.`)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ui-btn-secondary ui-btn-sm shrink-0"
                      onClick={() => {
                        void onKey(CYCLE_MODE_KEY);
                        setCycledAfter(lastMessageId);
                      }}
                    >
                      Next mode
                    </button>
                  </div>
                  <details className="mt-2 text-xs text-text-secondary">
                    <summary className="cursor-pointer text-text-primary">
                      What the modes mean
                    </summary>
                    <ul className="mt-2 space-y-1.5">
                      {Object.entries(CLAUDE_MODES).map(([id, m]) => (
                        <li key={id}>
                          <span className="font-medium text-text-primary">{m.label}</span> —{" "}
                          {m.means}
                        </li>
                      ))}
                    </ul>
                  </details>
                </section>
              )}
            </div>
            <div className="ui-sheet-foot">
              <button
                type="button"
                className="ui-btn-secondary w-full"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </Modal>,
          document.body,
        )}
    </>
  );
}

/** A row of choices; the one in force is marked, the one asked for pulses. */
function Choices({
  label,
  options,
  current,
  pending,
  onPick,
}: {
  label: string;
  options: { id: string; label: string; hint: string | null }[];
  /** The value in force (a model id, an effort level), lowercased. */
  current: string | null;
  pending: string | null;
  onPick: (id: string) => void;
}) {
  const picked = pending ?? options.find((o) => current?.includes(o.id))?.id ?? null;
  const hint = options.find((o) => o.id === picked)?.hint;
  return (
    <div className="mt-2" role="group" aria-label={label}>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = o.id === picked;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              className={cn(
                on ? "ui-chip-toggle-active" : "ui-chip-toggle",
                pending === o.id && "animate-pulse",
              )}
              onClick={() => {
                if (!on) onPick(o.id);
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {hint && <p className="ui-sheet-hint mt-1.5">{hint}</p>}
    </div>
  );
}

/** An agent whose list only opens in its own terminal: say so, then open it. */
function TerminalOnly({
  verb,
  agentName,
  onClick,
}: {
  verb: string;
  agentName: string;
  onClick: () => void;
}) {
  return (
    <div className="ui-sheet-row mt-2">
      <p className="ui-sheet-hint min-w-0 flex-1">
        {agentName} shows its list in the terminal view when you press this.
      </p>
      <button type="button" className="ui-btn-secondary ui-btn-sm shrink-0" onClick={onClick}>
        {verb}
      </button>
    </div>
  );
}

function cap(word: string): string {
  return word ? word[0]!.toUpperCase() + word.slice(1) : word;
}
