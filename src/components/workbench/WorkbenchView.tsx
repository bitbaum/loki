"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectWatch } from "@/components/projects/ProjectWatch";
import { TerminalSurface } from "@/components/terminal/TerminalSurface";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useMediaQuery } from "@/hooks/use-media-query";
import { NARROW_QUERY } from "@/hooks/use-is-narrow";
import { useSoloWindow } from "@/hooks/use-solo-window";
import { useWorkbenchLayout } from "@/hooks/use-workbench-layout";
import { useWorkbenchWindows } from "@/hooks/use-workbench-windows";
import { isPaneOpen, panesOnScreen } from "@/lib/workbench/layout";
import {
  WORKBENCH_COLUMNS_QUERY,
  WORKBENCH_SESSION_RAIL_KEY,
  workbenchHref,
  type WorkbenchPaneId,
} from "@/config/workbench";
import { WorkbenchNarrow } from "./WorkbenchNarrow";
import { WorkbenchPane } from "./WorkbenchPane";
import { WorkbenchStrip } from "./WorkbenchStrip";
import type { WorkbenchSite } from "./workbench-types";

/**
 * The workbench: this project's builder (Session) and what it is doing
 * (Watch) as columns of ONE window, and the site in a window of its own,
 * beside it or on the other screen. One box on the whole screen: the
 * session's, which types into the live agent or starts one.
 *
 * Nothing here is new UI. The columns are the Sessions page's surface and
 * the Watch page's thread, mounted as they are; the site is the live page
 * with the widget in owner mode, where pointing and "Fix it now" already
 * live. What the workbench adds is the arrangement: which panes this window
 * shows (use-workbench-layout.ts, the window's own) and where new windows
 * go (use-workbench-windows.ts). docs/architecture/workbench.md says why
 * the site is not a pane, and why Loki's chat is not either.
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
  const router = useRouter();
  const narrow = useMediaQuery(NARROW_QUERY);
  const columns = useMediaQuery(WORKBENCH_COLUMNS_QUERY);
  // The pane on screen where there is room for only one (panesOnScreen).
  const [focus, setFocus] = useState<WorkbenchPaneId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(rootRef);
  useSoloWindow(solo !== null);
  const { layout, open, close } = useWorkbenchLayout(projectId, solo);
  const windows = useWorkbenchWindows(projectId);

  // A column is half a window, so the session's Loki rail starts closed
  // there; a solo window is a whole one, where it has the room it has on
  // the Sessions page.
  const renderPane = (pane: WorkbenchPaneId) =>
    pane === "session" ? (
      <TerminalSurface
        local={local}
        initialTab={workspaceKey}
        rail={{ storageKey: WORKBENCH_SESSION_RAIL_KEY, defaultOpen: solo !== null }}
      />
    ) : (
      <ProjectWatch projectId={projectId} profileHref={`/projects/${projectId}`} />
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

  // Close closes the window the person opened. A window nobody's script
  // opened (a typed address, a bookmark) ignores window.close(), and its
  // chrome is hidden, so the same button then leads to the whole workbench.
  const closeSolo = () => {
    window.close();
    setTimeout(() => router.replace(workbenchHref(projectId)), 200);
  };

  if (solo)
    return (
      <div ref={rootRef} className="ui-workbench" data-fc-place="tab">
        <WorkbenchPane pane={solo} solo scroll={solo === "watch"} onClose={closeSolo}>
          {renderPane(solo)}
        </WorkbenchPane>
      </div>
    );

  const shown = panesOnScreen(layout, columns, focus);
  // With columns a button opens or closes its pane; with room for one it
  // chooses which pane is on screen, opening it if it was closed.
  const togglePane = (pane: WorkbenchPaneId) => {
    if (columns) return isPaneOpen(layout, pane) ? close(pane) : open(pane);
    if (!isPaneOpen(layout, pane)) open(pane);
    setFocus(pane);
  };
  // A pane in its own window leaves this one; a blocked popup leaves it be.
  const popOut = async (pane: WorkbenchPaneId) => {
    if ((await windows.openPane(pane)).how !== "blocked") close(pane);
  };

  return (
    <div ref={rootRef} className="ui-workbench" data-fc-place="tab">
      <WorkbenchStrip
        projectId={projectId}
        projectName={projectName}
        site={site}
        shownPanes={shown}
        onTogglePane={togglePane}
        placement={windows.placement}
        onPlacementChange={windows.setPlacement}
        onOpenSite={() => site && void windows.openSite(site.href)}
        fullscreen={fullscreen}
      />
      {windows.note && (
        <p className="ui-workbench-note" role="status">
          {windows.note}
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
              scroll={pane === "watch"}
              onPopOut={() => void popOut(pane)}
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
