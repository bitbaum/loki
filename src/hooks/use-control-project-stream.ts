"use client";

import { useEffect } from "react";
import type { FastProjectState } from "@/lib/control-fast-state";

export type BuilderPresence = { cloud: boolean; local: boolean; any: boolean };

/**
 * The dedicated /api/control/stream EventSource: per-project fast-state patches
 * pushed straight into the snapshot, without a full /api/control refetch.
 *
 * Reconnects on its own after 5s — an EventSource that errors is done, and a
 * control panel that silently stops updating is worse than one that reconnects
 * a beat late.
 */
export function useControlProjectStream(handlers: {
  onPatches: (patches: FastProjectState[]) => void;
  onPresence: (presence: BuilderPresence) => void;
  onRunnerConnected: (connected: boolean) => void;
}) {
  const { onPatches, onPresence, onRunnerConnected } = handlers;
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es = new EventSource("/api/control/stream");
      es.addEventListener("projects-update", (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as {
            projects: FastProjectState[];
            runnerConnected?: boolean;
            builderPresence?: BuilderPresence;
          };
          onPatches(payload.projects);
          if (payload.builderPresence) onPresence(payload.builderPresence);
          if (typeof payload.runnerConnected === "boolean")
            onRunnerConnected(payload.runnerConnected);
        } catch {
          /* ignore malformed events */
        }
      });
      es.onerror = () => {
        es?.close();
        reconnectTimer = setTimeout(connect, 5_000);
      };
    };

    connect();
    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [onPatches, onPresence, onRunnerConnected]);
}
