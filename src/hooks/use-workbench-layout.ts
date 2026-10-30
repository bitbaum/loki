"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { createWorkbenchBus } from "@/lib/workbench/bus";
import {
  DEFAULT_WORKBENCH_LAYOUT,
  parseLayout,
  serializeLayout,
  setPaneOpen,
  workbenchLayoutKey,
  type WorkbenchLayout,
} from "@/lib/workbench/layout";
import type { WorkbenchPaneId } from "@/config/workbench";

/** A name for this window, so its own bus messages are ignored. */
function newWindowId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Math.random());
}

/**
 * The panes THIS window shows — a window's own state, kept across its
 * reloads in sessionStorage and never shared: two full workbench windows of
 * one project (one per screen) each keep their own arrangement — and kept in
 * step with the project's other windows on this machine: a pane popped out
 * leaves here and returns when its window closes.
 *
 * `solo` is a window that shows one pane (`?pane=`): it announces that pane
 * open on mount (and again when it comes back from the back-forward cache)
 * and closed on every way out — pagehide, and the component unmounting on
 * a soft navigation away — and has no layout of its own. Opening windows is
 * the other hook's job (use-workbench-windows.ts).
 */
export function useWorkbenchLayout(projectId: string, solo: WorkbenchPaneId | null) {
  const [windowId] = useState(newWindowId);
  const [layout, setLayout] = useLocalStorageState<WorkbenchLayout>(
    workbenchLayoutKey(projectId),
    DEFAULT_WORKBENCH_LAYOUT,
    serializeLayout,
    parseLayout,
    "session",
  );

  useEffect(() => {
    const bus = createWorkbenchBus(projectId);
    if (solo) {
      const say = (state: "open" | "closed") =>
        bus.post({ kind: "pane", pane: solo, state, from: windowId });
      const hello = () => say("open");
      const bye = () => say("closed");
      hello();
      window.addEventListener("pageshow", hello);
      window.addEventListener("pagehide", bye);
      return () => {
        window.removeEventListener("pageshow", hello);
        window.removeEventListener("pagehide", bye);
        bye();
        bus.close();
      };
    }
    const unsubscribe = bus.subscribe((message) => {
      if (message.from === windowId) return;
      setLayout((prev) => setPaneOpen(prev, message.pane, message.state === "closed"));
    });
    return () => {
      unsubscribe();
      bus.close();
    };
  }, [projectId, solo, windowId, setLayout]);

  const open = useCallback(
    (pane: WorkbenchPaneId) => setLayout((prev) => setPaneOpen(prev, pane, true)),
    [setLayout],
  );
  const close = useCallback(
    (pane: WorkbenchPaneId) => setLayout((prev) => setPaneOpen(prev, pane, false)),
    [setLayout],
  );

  return { layout, open, close };
}
