"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Cpu } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  CLAUDE_EFFORTS,
  CLAUDE_EFFORT_CHOICES,
  CLAUDE_MODES,
  CLAUDE_MODE_CHOICES,
  commandOfKind,
  commandsFor,
} from "@/config/agent-commands";
import { Segmented } from "@/components/ui/segmented";
import { useClaudeTranscript } from "@/hooks/use-claude-transcript";
import {
  CYCLE_MODE_KEY,
  lastSetting,
  modelLabel,
  sessionEffort,
  sessionMode,
  sessionModel,
  type TranscriptItem,
} from "@/lib/claude-transcript";
import type { BuilderChannel } from "@/lib/constants/statuses";
import { typeCommand } from "@/lib/session-keystrokes";
import { OptionRow } from "./sheet-rows";
import { useLiveMode } from "./use-live-mode";

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
 * row settles on Claude Code's own reply ("Set model to Opus 5.5"), which it
 * writes the moment the change takes effect — or shows its refusal in its
 * own words. A runner too old to send that reply settles on the next answer
 * instead.
 *
 * The mode has no command, only Shift+Tab, and its order differs between
 * Claude Code versions — so the sheet lists the modes, and a tap presses
 * Shift+Tab until Claude Code's own footer names the one chosen, reading the
 * screen live (useLiveMode). It was a "Next mode" button whose result showed
 * only "with your next message", so pressing it looked like nothing.
 */
type SettingReply = Extract<TranscriptItem, { kind: "setting" }> | null;

/** What the chip reads from Claude Code's log — one derivation for both views. */
export function sessionInfoFrom(items: TranscriptItem[]) {
  return {
    model: sessionModel(items),
    effort: sessionEffort(items),
    modelReply: lastSetting(items, "model"),
    effortReply: lastSetting(items, "effort"),
    mode: sessionMode(items),
  };
}

/**
 * The model chip in the TERMINAL view, the same one the conversation view
 * shows. It existed only in the conversation, so a person watching the
 * terminal had no way to change the model but typing `/model` on a phone
 * keyboard (owner, 2026-10-19: "why can't I just easily switch between the
 * models?"). For Claude Code it reads the log itself, since the terminal
 * view has no conversation loaded; any other agent gets the chip with its
 * own command. Nothing until the agent is known — Claude's choices typed
 * into another CLI would be an error on its screen.
 */
export function TerminalSessionInfo({
  tab,
  channel,
  agent,
  onKey,
}: {
  tab: string;
  channel: BuilderChannel;
  agent: string | null;
  onKey: (bytes: string) => void | Promise<void>;
}) {
  if (!agent) return null;
  if (agent === "claude") return <ClaudeLogInfo tab={tab} channel={channel} onKey={onKey} />;
  return <SessionInfo model={null} mode={null} onKey={onKey} agent={agent} />;
}

function ClaudeLogInfo({
  tab,
  channel,
  onKey,
}: {
  tab: string;
  channel: BuilderChannel;
  onKey: (bytes: string) => void | Promise<void>;
}) {
  const { items } = useClaudeTranscript(tab, channel);
  return <SessionInfo {...sessionInfoFrom(items)} tab={tab} channel={channel} onKey={onKey} />;
}

/**
 * A change asked for from the sheet, until Claude Code answers it. `before`
 * is the reply already on screen when it was asked, so an older "Set model
 * to …" never reads as the answer to this one.
 */
type Asked = { id: string; before: string | null } | null;

/** Still waiting, answered, or refused — derived, so nothing syncs state. */
function askState(asked: Asked, reply: SettingReply, inForce: string | null) {
  if (!asked) return { pending: null, refused: null };
  const answered = reply !== null && reply.id !== asked.before;
  if (answered) return { pending: null, refused: reply.value ? null : reply.text };
  // An older runner sends no reply: the next answer naming it settles it.
  if ((inForce ?? "").toLowerCase().includes(asked.id)) return { pending: null, refused: null };
  return { pending: asked.id, refused: null };
}

export function SessionInfo({
  model,
  effort = null,
  modelReply = null,
  effortReply = null,
  mode,
  onKey,
  agent = "claude",
  tab = null,
  channel = null,
}: {
  /** The session, so the sheet can read its screen while open (the mode). */
  tab?: string | null;
  channel?: BuilderChannel | null;
  /** The model id on the newest answer, or null before one names it. */
  model: string | null;
  /** How hard the newest answer thought, when the log says. */
  effort?: { id: string; label: string } | null;
  /** Claude Code's newest answer to `/model …` / `/effort …`, if any. */
  modelReply?: SettingReply;
  effortReply?: SettingReply;
  mode: { id: string; label: string } | null;
  onKey: (bytes: string) => void | Promise<void>;
  agent?: string;
}) {
  const [open, setOpen] = useState(false);
  const live = useLiveMode(tab, channel, open && agent === "claude");
  // The mode asked for from the sheet while Shift+Tab walks to it, and how
  // that ended when it could not get there.
  const [wantMode, setWantMode] = useState<string | null>(null);
  const [modeNote, setModeNote] = useState<string | null>(null);
  // What was asked for: the alias ("sonnet") or level ("high").
  const [askedModel, setAskedModel] = useState<Asked>(null);
  const [askedEffort, setAskedEffort] = useState<Asked>(null);
  const modelAsk = askState(askedModel, modelReply, model);
  const effortAsk = askState(askedEffort, effortReply, effort?.id ?? null);
  const wantModel = modelAsk.pending;
  const wantEffort = effortAsk.pending;

  // The screen is newer than the log: the log has the mode only as of your
  // last message.
  const modeId = live.mode ?? mode?.id ?? null;
  // Always there for an agent whose model can be changed, even before its
  // log names one: the way to switch is the same tap whatever is known.
  if (!model && !mode && !commandOfKind(agent, "model")) return null;

  const name = model ? modelLabel(model) : null;
  const models = commandsFor(agent).filter(
    (c) => c.kind === "model" && /^\/model\s+\S+$/.test(c.text),
  );
  const modelListCmd = commandOfKind(agent, "model");
  const effortCmd = commandOfKind(agent, "effort");
  const agentName = agent === "claude" ? "Claude Code" : "The agent";
  const type = (text: string) => void typeCommand(onKey, text);

  // The chip names the model and nothing else, like the Claude app's: with
  // the mode beside it, "Opus 5.5 · Auto" truncated in the terminal view's
  // row. The mode is the sheet's third row, and in the label.
  const chip = wantModel ? `${cap(wantModel)}…` : (name ?? "Model");
  const modeLabel = modeId ? (CLAUDE_MODES[modeId]?.label ?? modeId) : null;
  const modeWords = wantMode ? "mode changing" : modeLabel ? `${modeLabel} mode` : null;

  /** Shift+Tab until the footer names `target`, at most once round the cycle. */
  const switchMode = async (target: string) => {
    setWantMode(target);
    setModeNote(null);
    const label = CLAUDE_MODES[target]?.label ?? target;
    // A tap the moment the sheet opens can come before the screen arrives.
    if (!live.read()) await changed(live.read, null);
    if (!live.read()) {
      // The screen could not be read: one press, and say where to look.
      await onKey(CYCLE_MODE_KEY);
      setWantMode(null);
      setModeNote(
        `Pressed Shift+Tab once. ${agentName} shows the mode at the bottom of its screen.`,
      );
      return;
    }
    for (let press = 0; press < 6; press++) {
      const now = live.read();
      if (now === target) {
        setWantMode(null);
        return;
      }
      await onKey(CYCLE_MODE_KEY);
      await changed(live.read, now);
    }
    setWantMode(null);
    const ended = live.read();
    setModeNote(
      `${agentName} does not offer ${label} in this session${ended ? `; it is on ${CLAUDE_MODES[ended]?.label ?? ended}` : ""}.`,
    );
  };

  return (
    <>
      <button
        type="button"
        className="ui-box-chip"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Model: ${chip}${modeWords ? `, ${modeWords}` : ""}. Change the model, effort or mode`}
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
                <p className="ui-sheet-hint">
                  {name
                    ? `Answering now: ${name}.`
                    : "Not named yet — it shows on the agent's next answer."}
                </p>
                <AskStatus pending={wantModel} refused={modelAsk.refused} agentName={agentName} />
                {models.length > 0 ? (
                  <Segmented
                    label="Model"
                    options={models.map((c) => ({
                      id: c.text.split(/\s+/)[1]!.toLowerCase(),
                      label: c.label.replace(/^Use\s+/, ""),
                      means: c.hint,
                    }))}
                    value={
                      models
                        .map((c) => c.text.split(/\s+/)[1]!.toLowerCase())
                        .find((id) => model?.toLowerCase().includes(id)) ?? null
                    }
                    pending={wantModel}
                    onChange={(id) => {
                      type(`${modelListCmd?.text.split(/\s+/)[0] ?? "/model"} ${id}`);
                      setAskedModel({ id, before: modelReply?.id ?? null });
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
                  <p className="ui-sheet-hint">How long it thinks before it acts.</p>
                  <AskStatus
                    pending={wantEffort ? (CLAUDE_EFFORTS[wantEffort] ?? wantEffort) : null}
                    refused={effortAsk.refused}
                    agentName={agentName}
                  />
                  <Segmented
                    label="Effort"
                    options={CLAUDE_EFFORT_CHOICES.map((c) => ({ ...c }))}
                    value={effort?.id ?? null}
                    pending={wantEffort}
                    onChange={(id) => {
                      type(`${effortCmd.text.split(/\s+/)[0]} ${id}`);
                      setAskedEffort({ id, before: effortReply?.id ?? null });
                    }}
                  />
                </section>
              )}

              {agent === "claude" && (modeId || tab) && (
                <section className="ui-sheet-section">
                  <h3 className="ui-sheet-label">Mode</h3>
                  <p className="ui-sheet-hint">What it may do without asking you first.</p>
                  <div className="mt-1 flex flex-col gap-1" role="radiogroup" aria-label="Mode">
                    {[
                      ...CLAUDE_MODE_CHOICES,
                      ...(modeId === "bypassPermissions" ? [modeId] : []),
                    ].map((id) => (
                      <OptionRow
                        key={id}
                        title={CLAUDE_MODES[id]!.label}
                        detail={CLAUDE_MODES[id]!.means}
                        active={(wantMode ?? modeId) === id}
                        busy={wantMode === id}
                        disabled={wantMode !== null && wantMode !== id}
                        onSelect={() => {
                          if (!wantMode && modeId !== id) void switchMode(id);
                        }}
                      />
                    ))}
                  </div>
                  {modeNote && (
                    <p className="ui-sheet-hint" role="status">
                      {modeNote}
                    </p>
                  )}
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

/** Said only while a change is on its way, or when the agent refused it. */
function AskStatus({
  pending,
  refused,
  agentName,
}: {
  pending: string | null;
  refused: string | null;
  agentName: string;
}) {
  if (refused) return <p className="ui-error" role="status">{`${agentName} said: ${refused}`}</p>;
  if (!pending) return null;
  return (
    <p className="ui-sheet-hint" role="status">
      {`Switching to ${cap(pending)} — ${agentName} confirms here in a moment.`}
    </p>
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

/** Resolves once `read()` differs from `from`, or after 2.5s. */
function changed(read: () => string | null, from: string | null): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (read() !== from || Date.now() - started > 2500) resolve();
      else window.setTimeout(tick, 100);
    };
    tick();
  });
}
