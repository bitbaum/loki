"use client";

import { useEffect, useRef, useState } from "react";
import type { BuilderChannel } from "@/lib/event-stream-types";
import { modeFromFooter } from "@/lib/claude-mode-footer";
import { runnerTransport } from "./terminal-transport";

/** Wide and tall enough that nothing Claude Code draws wraps or scrolls off
 *  differently from the real screen around its footer. */
const COLS = 220;
const ROWS = 60;

/**
 * The session's permission mode read off its screen, live, while `enabled`
 * (the sheet is open). It watches the same stream the terminal view draws,
 * into an xterm that is never put on the page, so it works from the chat view
 * too, where no terminal is mounted.
 *
 * `read()` gives the newest value synchronously, for a loop that presses
 * Shift+Tab and waits for the footer to move; `mode` is the same for render.
 */
export function useLiveMode(tab: string | null, channel: BuilderChannel | null, enabled: boolean) {
  const [mode, setMode] = useState<string | null>(null);
  const latest = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !tab) return;
    let disposed = false;
    let stop: (() => void) | null = null;
    let term: import("@xterm/xterm").Terminal | null = null;
    void import("@xterm/xterm").then(({ Terminal }) => {
      if (disposed) return;
      const transport = runnerTransport(tab, channel ?? undefined);
      const t = new Terminal({
        cols: COLS,
        rows: ROWS,
        scrollback: 0,
        convertEol: transport.convertEol,
        allowProposedApi: true,
      });
      term = t;
      const settle = () => {
        const buf = t.buffer.active;
        const lines: string[] = [];
        for (let y = 0; y < t.rows; y++) {
          lines.push(buf.getLine(buf.baseY + y)?.translateToString(true) ?? "");
        }
        // The footer is the last thing drawn; rows below it are blank.
        while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
        // A screen with no footer (a menu open, mid-redraw) keeps the last.
        const next = modeFromFooter(lines);
        if (!next || next === latest.current) return;
        latest.current = next;
        setMode(next);
      };
      t.onWriteParsed(settle);
      stop = transport.connect({
        onOutput: (data) => t.write(data),
        onReset: () => t.reset(),
        onStatus: () => {},
        onConnected: () => {},
      });
    });
    return () => {
      disposed = true;
      stop?.();
      term?.dispose();
      latest.current = null;
      setMode(null);
    };
  }, [tab, channel, enabled]);
  return { mode, read: () => latest.current };
}
