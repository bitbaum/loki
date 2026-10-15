"use client";
import { useCallback, useRef } from "react";
import type { TerminalTransport } from "@/components/terminal/terminal-transport";
import { terminalInputChunks } from "@/lib/terminal-input";

/** Serialize paste chunks and Enter; chat callers can retain a draft on failure. */
export function useTerminalInput(transport: TerminalTransport | null) {
  const chain = useRef<Promise<void>>(Promise.resolve());
  return useCallback(
    (bytes: string, reportFailure = false): Promise<void> => {
      if (!transport)
        return reportFailure ? Promise.reject(new Error("No session attached")) : Promise.resolve();
      const run = chain.current.then(async () => {
        for (const chunk of terminalInputChunks(bytes)) await transport.sendKey(chunk);
      });
      chain.current = run.catch(() => {});
      return reportFailure ? run : chain.current;
    },
    [transport],
  );
}
