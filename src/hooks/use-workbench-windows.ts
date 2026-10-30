"use client";

import { useCallback, useState } from "react";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { parsePlacement, WORKBENCH_PLACEMENT_KEY } from "@/lib/workbench/layout";
import {
  openingNote,
  openWorkbenchWindow,
  primeScreens,
  type WindowOpening,
} from "@/lib/workbench/windows";
import {
  workbenchHref,
  workbenchWindowName,
  type WorkbenchPaneId,
  type WorkbenchPlacement,
} from "@/config/workbench";

/**
 * The windows a workbench opens — the project's site, or one of its own
 * panes — and the one choice that places them all: beside this window, or
 * on the other screen, remembered on this device. The last opening's note
 * (a blocked popup) is kept here so the page can say it once.
 */
export function useWorkbenchWindows(projectId: string) {
  const [placement, setPlacement] = useLocalStorageState<WorkbenchPlacement>(
    WORKBENCH_PLACEMENT_KEY,
    "beside",
    String,
    parsePlacement,
  );
  const [last, setLast] = useState<WindowOpening | null>(null);
  // Choosing the other screen is the moment to ask the browser for it (see
  // primeScreens): the choice is a click, and the prompt spends it here
  // rather than on the open that follows.
  const choosePlacement = useCallback(
    (next: WorkbenchPlacement) => {
      if (next === "other-screen") primeScreens();
      setPlacement(next);
    },
    [setPlacement],
  );

  const openWindow = useCallback(
    async (url: string, name: string) => {
      const opening = await openWorkbenchWindow({ url, name, placement });
      setLast(opening);
      return opening;
    },
    [placement],
  );
  const openSite = useCallback(
    (href: string) => openWindow(href, workbenchWindowName(projectId, "site")),
    [openWindow, projectId],
  );
  const openPane = useCallback(
    (pane: WorkbenchPaneId) =>
      openWindow(
        new URL(workbenchHref(projectId, pane), window.location.href).href,
        workbenchWindowName(projectId, pane),
      ),
    [openWindow, projectId],
  );

  return { placement, setPlacement: choosePlacement, openSite, openPane, note: openingNote(last) };
}
