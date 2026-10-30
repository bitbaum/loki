"use client";

import Link from "next/link";
import { ArrowLeft, Globe, Maximize2, Minimize2 } from "lucide-react";
import { ChoiceMenu } from "@/components/ui/choice-menu";
import {
  WORKBENCH_PANE_IDS,
  WORKBENCH_PANES,
  WORKBENCH_PLACEMENTS,
  type WorkbenchPaneId,
  type WorkbenchPlacement,
} from "@/config/workbench";
import { cn } from "@/lib/utils";
import type { WorkbenchSite } from "./workbench-types";

const PLACEMENT_CHOICES = (Object.keys(WORKBENCH_PLACEMENTS) as WorkbenchPlacement[]).map(
  (value) => ({ value, label: WORKBENCH_PLACEMENTS[value].label }),
);

/**
 * The workbench's one header row: the way back and the title, which panes
 * this window shows (the terminal's own pane buttons), where new windows go,
 * the site, and full screen. The site is the row's one primary action: it is
 * the thing being built, and the reason the other two are on the screen.
 */
export function WorkbenchStrip({
  projectId,
  projectName,
  site,
  shownPanes,
  onTogglePane,
  placement,
  onPlacementChange,
  onOpenSite,
  fullscreen,
}: {
  projectId: string;
  projectName: string;
  site: WorkbenchSite | null;
  /** On screen now: every open pane where there is room for columns, one
   *  of them where there is not — then the buttons choose which. */
  shownPanes: readonly WorkbenchPaneId[];
  onTogglePane: (pane: WorkbenchPaneId) => void;
  placement: WorkbenchPlacement;
  onPlacementChange: (placement: WorkbenchPlacement) => void;
  onOpenSite: () => void;
  fullscreen: { active: boolean; supported: boolean; toggle: () => void };
}) {
  return (
    <header className="ui-workbench-strip">
      <Link href={`/projects/${projectId}`} className="ui-page-back">
        <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{projectName}</span>
      </Link>
      <h1 className="ui-workbench-title">Workbench</h1>
      <div className="ui-workbench-strip-group" role="group" aria-label="Panes in this window">
        {WORKBENCH_PANE_IDS.map((id) => {
          const meta = WORKBENCH_PANES[id];
          const on = shownPanes.includes(id);
          return (
            <button
              key={id}
              type="button"
              className={cn("ui-term-pane-btn", on && "ui-term-pane-btn-on")}
              aria-pressed={on}
              onClick={() => onTogglePane(id)}
            >
              <meta.icon className="h-3.5 w-3.5" aria-hidden="true" />
              {meta.label}
            </button>
          );
        })}
      </div>
      <span className="flex-1" />
      <ChoiceMenu
        label="New windows"
        value={placement}
        options={PLACEMENT_CHOICES}
        onChange={onPlacementChange}
      />
      {site && (
        <button type="button" className="ui-btn-primary ui-btn-sm gap-1.5" onClick={onOpenSite}>
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          {site.kind === "preview" ? "Open the preview" : "Open the site"}
        </button>
      )}
      {fullscreen.supported && (
        <button
          type="button"
          className="ui-term-pane-btn"
          onClick={fullscreen.toggle}
          aria-pressed={fullscreen.active}
          aria-label={fullscreen.active ? "Leave full screen" : "Full screen"}
          title={fullscreen.active ? "Leave full screen" : "Full screen"}
        >
          {fullscreen.active ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      )}
    </header>
  );
}
