"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import { Lightbulb, SquareTerminal } from "lucide-react";
import { commandsFor } from "@/config/agent-commands";
import { commandAction, type TerminalAction } from "@/lib/terminal-commands";
import { useScreenActions } from "./use-screen-actions";

/**
 * "Typed /login into the terminal" — said for a moment after a click, so the
 * person knows the button did something even while the agent is slow to draw.
 */
function useTypedNotice(): [string | null, (display: string) => void] {
  const [typed, setTyped] = useState<string | null>(null);
  useEffect(() => {
    if (!typed) return;
    const t = window.setTimeout(() => setTyped(null), 3_000);
    return () => window.clearTimeout(t);
  }, [typed]);
  return [typed, setTyped];
}

function ActionButton({
  action,
  onRun,
}: {
  action: TerminalAction;
  onRun: (action: TerminalAction) => void;
}) {
  return (
    <button
      type="button"
      className="ui-term-action"
      title={action.why}
      onClick={() => onRun(action)}
    >
      <span>{action.label}</span>
      <kbd className="ui-term-action-kbd">{action.display}</kbd>
    </button>
  );
}

/**
 * What the screen needs typed, said plainly, one click from the session:
 * "The agent is signed out… [Sign in /login]". The first action's sentence is
 * the headline because it describes the situation; the rest are its options.
 *
 * A click TYPES into the terminal (the same bytes as the keyboard) — the
 * command is shown on the button so a person learns it, and can type it
 * themselves next time.
 */
export function TerminalActions({
  readScreenRef,
  agent,
  onKey,
}: {
  /** The attached session's rendered screen (TerminalView). */
  readScreenRef: MutableRefObject<((rows: number) => string[]) | null>;
  /** The CLI in the tab — whose commands may be offered. */
  agent: string | null;
  onKey: (bytes: string) => void;
}) {
  const actions = useScreenActions(readScreenRef, agent);
  const [typed, setTyped] = useTypedNotice();
  if (actions.length === 0 && !typed) return null;
  const run = (a: TerminalAction) => {
    onKey(a.bytes);
    setTyped(a.display);
  };
  return (
    <section
      className="ui-term-actions"
      aria-label="What the terminal needs from you"
      aria-live="polite"
    >
      {actions.length > 0 && (
        <>
          <p className="ui-term-actions-why">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{actions[0]!.why}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {actions.map((a) => (
              <ActionButton key={a.id} action={a} onRun={run} />
            ))}
          </div>
        </>
      )}
      {/* Said even while the buttons stay: the screen keeps its old message
          until the agent redraws, and a click with no sign of having worked
          gets clicked again. */}
      {typed && (
        <p className="ui-term-actions-why text-text-secondary">
          <SquareTerminal className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Typed {typed} into the terminal.</span>
        </p>
      )}
    </section>
  );
}

/**
 * Every command the running agent understands, as buttons — the answer to
 * "what can I even type here?". Collapsed by default: it is a reference, and
 * the strip above already offers the one the screen calls for.
 */
export function TerminalCommandList({
  agent,
  onKey,
  open,
}: {
  agent: string | null;
  onKey: (bytes: string) => void;
  /** Start expanded (the prompt library, where it was asked for with "/"). */
  open?: boolean;
}) {
  const [typed, setTyped] = useTypedNotice();
  const commands = commandsFor(agent);
  if (commands.length === 0) return null;
  return (
    <details className="ui-term-commands" open={open}>
      <summary className="ui-term-commands-summary">
        Commands — change model, sign in, free up memory…
      </summary>
      <ul className="ui-term-commands-list">
        {commands.map((c) => (
          <li key={c.text}>
            <button
              type="button"
              className="ui-term-command"
              onClick={() => {
                onKey(commandAction(c, c.hint).bytes);
                setTyped(c.text);
              }}
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-xs font-medium text-text-primary">{c.label}</span>
                <span className="text-micro leading-snug text-text-muted">{c.hint}</span>
              </span>
              <kbd className="ui-term-action-kbd">{c.text}</kbd>
            </button>
          </li>
        ))}
      </ul>
      <p className="ui-term-commands-note" aria-live="polite">
        {typed
          ? `Typed ${typed} into the terminal.`
          : "Each one is typed into the terminal for you, then Enter."}
      </p>
    </details>
  );
}
