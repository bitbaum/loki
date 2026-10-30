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
import { openWorkbenchWindow, type WindowOpening } from "@/lib/workbench/windows";
import {
  workbenchHref,
  workbenchWindowName,
  type WorkbenchPaneId,
  type WorkbenchPlacement,
} from "@/config/workbench";

/** A name for this window, so its own bus messages are ignored. */
function newWindowId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Math.random());
}

/**
 * The panes THIS window shows, remembered per project on this device, and
 * kept in step with the project's other windows on this machine: a pane
 * popped out leaves here and returns when its window closes.
 *
 * `solo` is a window that shows one pane (`?pane=`): it announces that pane
 * open on mount and closed on pagehide, and has no layout of its own.
 */
export function useWorkbenchLayout(projectId: string, solo: WorkbenchPaneId | null) {
  const [windowId] = useState(newWindowId);
  const [layout, setLayout] = useLocalStorageState<WorkbenchLayout>(
    workbenchLayoutKey(projectId),
    DEFAULT_WORKBENCH_LAYOUT,
    serializeLayout,
    parseLayout,
  );
  const [lastOpening, setLastOpening] = useState<WindowOpening | null>(null);

  useEffect(() => {
    const bus = createWorkbenchBus(projectId);
    if (solo) {
      bus.post({ kind: "pane", pane: solo, state: "open", from: windowId });
      const bye = () => bus.post({ kind: "pane", pane: solo, state: "closed", from: windowId });
      window.addEventListener("pagehide", bye);
      return () => {
        window.removeEventListener("pagehide", bye);
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
  /** Open a pane in its own window; this window stops drawing it. */
  const popOut = useCallback(
    async (pane: WorkbenchPaneId, placement: WorkbenchPlacement) => {
      const opening = await openWorkbenchWindow({
        url: new URL(workbenchHref(projectId, pane), window.location.href).href,
        name: workbenchWindowName(projectId, pane),
        placement,
      });
      setLastOpening(opening);
      if (opening.how !== "blocked") close(pane);
      return opening;
    },
    [projectId, close],
  );

  return { layout, open, close, popOut, lastOpening };
}
