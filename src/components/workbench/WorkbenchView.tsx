"use client";

import { useCallback, useRef, useState } from "react";
import { LokiWorkspace } from "@/components/loki/LokiWorkspace";
import { TerminalSurface } from "@/components/terminal/TerminalSurface";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { useMediaQuery } from "@/hooks/use-media-query";
import { NARROW_QUERY } from "@/hooks/use-is-narrow";
import { useSoloWindow } from "@/hooks/use-solo-window";
import { useWorkbenchLayout } from "@/hooks/use-workbench-layout";
import { parsePlacement, WORKBENCH_PLACEMENT_KEY } from "@/lib/workbench/layout";
import { openWorkbenchWindow, type WindowOpening } from "@/lib/workbench/windows";
import {
  WORKBENCH_COLUMNS_QUERY,
  WORKBENCH_RAIL_KEYS,
  workbenchHref,
  workbenchWindowName,
  type WorkbenchPaneId,
  type WorkbenchPlacement,
} from "@/config/workbench";
import { WorkbenchNarrow } from "./WorkbenchNarrow";
import { WorkbenchPane } from "./WorkbenchPane";
import { WorkbenchStrip } from "./WorkbenchStrip";
import type { WorkbenchSite } from "./workbench-types";

/** What an opening that needs a word from us says; the rest say nothing. */
function openingNote(opening: WindowOpening | null): string | null {
  if (opening?.how === "blocked")
    return "Your browser blocked the window. Allow pop-ups for Loki and try again.";
  return null;
}

/**
 * The workbench: this project's session and Loki as columns of ONE window,
 * and the site in a window of its own, beside it or on the other screen.
 *
 * Nothing here is new UI. The columns are the Sessions page's surface and
 * the Loki page's workspace, mounted as they are; the site is the live
 * page with the widget in owner mode, where pointing and "Fix it now"
 * already live. What the workbench adds is the arrangement — and the
 * arrangement is device-local state (hooks/use-workbench-layout.ts).
 * docs/architecture/workbench.md says why the site is not a pane.
 */
export function WorkbenchView({
  projectId,
  projectName,
  workspaceKey,
  local,
  site,
  solo,
}: {
  projectId: string;
  projectName: string;
  /** The project as the session and the chat know it (`?project=`). */
  workspaceKey: string;
  /** A Loki-owned shell can be provisioned here (lib/runtime). */
  local: boolean;
  site: WorkbenchSite | null;
  /** `?pane=`: this window shows that one pane and nothing else. */
  solo: WorkbenchPaneId | null;
}) {
  const narrow = useMediaQuery(NARROW_QUERY);
  const columns = useMediaQuery(WORKBENCH_COLUMNS_QUERY);
  // The pane on screen where there is room for only one. Session state: a
  // window tiled beside the site shows one pane and the strip picks which.
  const [focus, setFocus] = useState<WorkbenchPaneId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(rootRef);
  useSoloWindow(solo !== null);
  const { layout, open, close, popOut, lastOpening } = useWorkbenchLayout(projectId, solo);
  const [placement, setPlacement] = useLocalStorageState<WorkbenchPlacement>(
    WORKBENCH_PLACEMENT_KEY,
    "beside",
    String,
    parsePlacement,
  );
  const [siteOpening, setSiteOpening] = useState<WindowOpening | null>(null);

  const openSite = useCallback(async () => {
    if (!site) return;
    setSiteOpening(
      await openWorkbenchWindow({
        url: site.ownerUrl ?? site.url,
        name: workbenchWindowName(projectId, "site"),
        placement,
      }),
    );
  }, [site, projectId, placement]);

  // A column is half a window; a solo window is a whole one, where each
  // surface's own rail has the room it has on its own page.
  const renderPane = (pane: WorkbenchPaneId) =>
    pane === "session" ? (
      <TerminalSurface
        local={local}
        initialTab={workspaceKey}
        rail={{ storageKey: WORKBENCH_RAIL_KEYS.session, defaultOpen: solo !== null }}
      />
    ) : (
      <LokiWorkspace
        // The path only: the workspace writes ?c= and ?project= beside the
        // params already there, and `?pane=` is one of those.
        basePath={workbenchHref(projectId)}
        project={workspaceKey}
        history={{ storageKey: WORKBENCH_RAIL_KEYS.loki, defaultPinned: solo !== null }}
      />
    );

  if (narrow && !solo)
    return (
      <WorkbenchNarrow
        projectId={projectId}
        projectName={projectName}
        workspaceKey={workspaceKey}
        site={site}
      />
    );

  if (solo)
    return (
      <div ref={rootRef} className="ui-workbench" data-fc-place="tab">
        <WorkbenchPane pane={solo} solo onClose={() => window.close()}>
          {renderPane(solo)}
        </WorkbenchPane>
      </div>
    );

  const note = openingNote(siteOpening) ?? openingNote(lastOpening);
  const shown: WorkbenchPaneId[] = columns
    ? layout.open
    : layout.open.length === 0
      ? []
      : [focus && layout.open.includes(focus) ? focus : layout.open[0]];
  const togglePane = (pane: WorkbenchPaneId) => {
    if (columns) return layout.open.includes(pane) ? close(pane) : open(pane);
    if (!layout.open.includes(pane)) open(pane);
    setFocus(pane);
  };
  return (
    <div ref={rootRef} className="ui-workbench" data-fc-place="tab">
      <WorkbenchStrip
        projectId={projectId}
        projectName={projectName}
        site={site}
        openPanes={layout.open}
        shownPanes={shown}
        onTogglePane={togglePane}
        placement={placement}
        onPlacementChange={setPlacement}
        onOpenSite={() => void openSite()}
        fullscreen={fullscreen}
      />
      {note && (
        <p className="ui-workbench-note" role="status">
          {note}
        </p>
      )}
      {layout.open.length === 0 ? (
        <div className="ui-empty-page text-sm text-text-muted">
          Every pane is in its own window. Bring one back with the buttons above.
        </div>
      ) : (
        <div className="ui-workbench-columns">
          {shown.map((pane) => (
            <WorkbenchPane
              key={pane}
              pane={pane}
              solo={false}
              onPopOut={() => void popOut(pane, placement)}
              onClose={() => close(pane)}
            >
              {renderPane(pane)}
            </WorkbenchPane>
          ))}
        </div>
      )}
    </div>
  );
}
