"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import {
  COMMAND_WINDOW_ROWS,
  sameActions,
  screenActions,
  type TerminalAction,
} from "@/lib/terminal-commands";

/** How often the screen is re-read for something to type. */
const POLL_MS = 3_000;

/**
 * What the attached session's screen needs TYPED right now — the agent's own
 * command or a key (lib/terminal-commands). Polls the rendered screen while
 * mounted: the person writing a task in the box is exactly the one who does
 * not know a command exists. An agent with no known commands still gets
 * the menu keys, since every CLI draws the same "❯ 1." picker.
 */
export function useScreenActions(
  readScreenRef: MutableRefObject<((rows: number) => string[]) | null>,
  agent: string | null,
): TerminalAction[] {
  const [actions, setActions] = useState<TerminalAction[]>([]);
  useEffect(() => {
    const read = () => {
      const lines = readScreenRef.current?.(COMMAND_WINDOW_ROWS) ?? [];
      const next = screenActions(lines, agent);
      setActions((prev) => (sameActions(prev, next) ? prev : next));
    };
    const first = window.setTimeout(read, 0);
    const t = window.setInterval(read, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [readScreenRef, agent]);
  return actions;
}
