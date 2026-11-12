"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { TerminalSurface } from "@/components/terminal/TerminalSurface";
import Link from "next/link";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useRunState } from "@/hooks/use-run-state";
import { useMediaQuery } from "@/hooks/use-media-query";
import { NARROW_QUERY } from "@/hooks/use-is-narrow";
import { useWorkbenchFocus } from "@/hooks/use-workbench-focus";
import { useWorkbenchLayout } from "@/hooks/use-workbench-layout";
import { useWorkbenchWindows } from "@/hooks/use-workbench-windows";
import { isPaneOpen } from "@/lib/workbench/layout";
import { trackUsage } from "@/lib/usage/track";
import {
  WORKBENCH_COLUMNS_QUERY,
  WORKBENCH_SESSION_RAIL_KEY,
  workbenchHref,
  type WorkbenchPaneId,
  type WorkbenchPlacement,
} from "@/config/workbench";
import { WorkbenchFrame } from "./WorkbenchFrame";
import { WorkbenchNarrow } from "./WorkbenchNarrow";
import { WorkbenchSiteView } from "./WorkbenchSiteView";
import { WorkbenchStrip } from "./WorkbenchStrip";
import type { WorkbenchReview, WorkbenchSite } from "./workbench-types";

/**
 * The workbench: one project on one screen, read left to right — the site
 * as Loki's browser sees it, then the robot at work with one line of state
 * over it and its ONE box under it. The real site is a window of its own,
 * one tap from the picture, beside this window or on the other screen.
 *
 * Nothing here is new UI. The robot is the Sessions surface in its quiet
 * shape (no builder picker, no tab strip of other projects — which builder
 * runs a project is a stored decision); the site picture is the review
 * worker's frame; the state line is the Watch track's own sentence. What
 * the workbench adds is the arrangement, and what it takes away is every
 * control that is not the site, the robot or the box.
 * docs/architecture/workbench.md says why the site is a picture here.
 */
export function WorkbenchView({
  projectId,
  projectName,
  workspaceKey,
  local,
  site,
  initialReview,
  solo,
}: {
  projectId: string;
  projectName: string;
  /** The project as the session knows it (`?project=`). */
  workspaceKey: string;
  /** A Loki-owned shell can be provisioned here (lib/runtime). */
  local: boolean;
  site: WorkbenchSite | null;
  /** Loki's latest look at the site, if it has taken one. */
  initialReview: WorkbenchReview | null;
  /** `?pane=`: this window shows that one pane and nothing else. */
  solo: WorkbenchPaneId | null;
}) {
  const router = useRouter();
  const narrow = useMediaQuery(NARROW_QUERY);
  const columns = useMediaQuery(WORKBENCH_COLUMNS_QUERY);
  const rootRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(rootRef);
  // One screen, nothing around it: the app's chrome leaves while the
  // workbench is open (a phone keeps its own — the rows need its bars).
  useWorkbenchFocus(!narrow || solo !== null);
  const { layout, close } = useWorkbenchLayout(projectId, solo);
  const windows = useWorkbenchWindows(projectId);
  const run = useRunState(projectId);
  useEffect(() => {
    trackUsage({ surface: "projects.workbench", action: "shown", target: solo ? "solo" : null });
  }, [solo]);
  const tap = (target: string) =>
    trackUsage({ surface: "projects.workbench", action: "tap", target });

  // A column is half a window, so the session's Loki rail starts closed
  // there; a solo window is a whole one, where it has the room it has on
  // the Sessions page.
  const robot = (
    <TerminalSurface
      local={local}
      initialTab={workspaceKey}
      quiet
      rail={{ storageKey: WORKBENCH_SESSION_RAIL_KEY, defaultOpen: solo !== null }}
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

  // Close closes the window the person opened. A window nobody's script
  // opened (a typed address, a bookmark) ignores window.close(), and its
  // chrome is hidden, so the same button then leads to the whole workbench.
  const closeSolo = () => {
    window.close();
    setTimeout(() => router.replace(workbenchHref(projectId)), 200);
  };

  // The robot's window: its bar is the build's state, its body the session.
  const robotFrame = (onClose?: () => void) => (
    <WorkbenchFrame
      label="The agent"
      tone={run.tone}
      title={run.text}
      aside={
        run.hasRun ? (
          <Link
            href={`/projects/${encodeURIComponent(projectId)}/watch`}
            className="ui-link shrink-0 text-sm"
          >
            Watch it work
          </Link>
        ) : undefined
      }
      onClose={onClose}
    >
      {robot}
    </WorkbenchFrame>
  );

  if (solo)
    return (
      <div ref={rootRef} className="ui-workbench" data-fc-place="tab">
        {robotFrame(closeSolo)}
      </div>
    );

  const openSite = (placement: WorkbenchPlacement) => {
    if (!site) return;
    tap(placement === "beside" ? "open-site" : "site-screen");
    void windows.openSite(site.href, placement);
  };
  // The robot in its own window leaves this one; a refused popup leaves it be.
  const openRobot = async (placement: WorkbenchPlacement) => {
    tap("robot-window");
    if ((await windows.openPane("session", placement)).how !== "blocked") close("session");
  };
  const toggleFullscreen = () => {
    tap("fullscreen");
    fullscreen.toggle();
  };
  const robotHere = isPaneOpen(layout, "session");

  return (
    <div ref={rootRef} className="ui-workbench" data-fc-place="tab">
      <WorkbenchStrip
        projectId={projectId}
        projectName={projectName}
        site={site}
        onOpenSite={openSite}
        onOpenRobot={(placement) => void openRobot(placement)}
        fullscreen={{ ...fullscreen, toggle: toggleFullscreen }}
      />
      {windows.note && (
        <p className="ui-workbench-note" role="status">
          {windows.note}
        </p>
      )}
      <div className="ui-workbench-columns">
        {(columns || !robotHere) && (
          <WorkbenchSiteView
            projectId={projectId}
            site={site}
            initialReview={initialReview}
            onOpenSite={() => openSite("beside")}
          />
        )}
        {robotHere && robotFrame()}
      </div>
    </div>
  );
}
