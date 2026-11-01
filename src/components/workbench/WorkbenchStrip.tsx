"use client";

import Link from "next/link";
import { ArrowLeft, AppWindow, Globe, Maximize2, Minimize2, MonitorUp } from "lucide-react";
import { RowActions } from "@/components/ui/row-actions";
import { WORKBENCH_PANES, WORKBENCH_PLACEMENTS, type WorkbenchPlacement } from "@/config/workbench";
import type { WorkbenchSite } from "./workbench-types";

/**
 * The workbench's one header row: the way back, the title, the site, and
 * one "⋯" for everything else. The site is the row's one primary action —
 * it is the thing being built, and the reason the rest is on the screen.
 * Windows, screens and full screen live behind the dots: chosen rarely,
 * never read while working (progressive disclosure, as the forms do it).
 */
export function WorkbenchStrip({
  projectId,
  projectName,
  site,
  onOpenSite,
  onOpenRobot,
  fullscreen,
}: {
  projectId: string;
  projectName: string;
  site: WorkbenchSite | null;
  onOpenSite: (placement: WorkbenchPlacement) => void;
  onOpenRobot: (placement: WorkbenchPlacement) => void;
  fullscreen: { active: boolean; supported: boolean; toggle: () => void };
}) {
  const robot = WORKBENCH_PANES.session.label;
  const siteWord = site?.kind === "preview" ? "the preview" : "the site";
  return (
    <header className="ui-workbench-strip">
      <Link href={`/projects/${projectId}`} className="ui-page-back">
        <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{projectName}</span>
      </Link>
      <h1 className="ui-workbench-title">Workbench</h1>
      <span className="flex-1" />
      {site && (
        <button
          type="button"
          className="ui-btn-primary ui-btn-sm gap-1.5"
          onClick={() => onOpenSite("beside")}
        >
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          Open {siteWord}
        </button>
      )}
      <RowActions label="Windows and screens">
        {(Object.keys(WORKBENCH_PLACEMENTS) as WorkbenchPlacement[]).map((placement) => (
          <button
            key={`robot:${placement}`}
            type="button"
            role="menuitem"
            className="ui-menu-item"
            onClick={() => onOpenRobot(placement)}
          >
            {placement === "beside" ? (
              <AppWindow className="h-4 w-4" aria-hidden="true" />
            ) : (
              <MonitorUp className="h-4 w-4" aria-hidden="true" />
            )}
            {robot} {WORKBENCH_PLACEMENTS[placement].label}
          </button>
        ))}
        {site && (
          <button
            type="button"
            role="menuitem"
            className="ui-menu-item"
            onClick={() => onOpenSite("other-screen")}
          >
            <MonitorUp className="h-4 w-4" aria-hidden="true" />
            {capitalize(siteWord)} {WORKBENCH_PLACEMENTS["other-screen"].label}
          </button>
        )}
        {fullscreen.supported && (
          <button
            type="button"
            role="menuitem"
            className="ui-menu-item"
            onClick={fullscreen.toggle}
          >
            {fullscreen.active ? (
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            )}
            {fullscreen.active ? "Leave full screen" : "Full screen"}
          </button>
        )}
      </RowActions>
    </header>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
