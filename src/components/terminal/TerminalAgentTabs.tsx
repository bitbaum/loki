"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { TerminalLaunchPanel } from "./TerminalLaunchPanel";
import { TerminalTabStrip, type TerminalTab } from "./TerminalTabStrip";
import { moveTab, nudgeTab, togglePin, type TabLayout } from "./terminal-tab-order";

type LaunchProps = Omit<ComponentProps<typeof TerminalLaunchPanel>, "onCancel">;

/**
 * The agent sessions' strip with everything the operator can do to it: pick,
 * start, rename, close, drag into order, pin to the front, group by project.
 * The launcher the "+" opens and the line a failed action reports to sit
 * directly beneath it, so cause and effect are in one place.
 */
export function TerminalAgentTabs({
  tabs,
  activeTab,
  onSelect,
  layout,
  setLayout,
  onRename,
  onClose,
  launch,
  launchOpen,
  setLaunchOpen,
  error,
}: {
  /** In the order they are shown (already arranged). */
  tabs: TerminalTab[];
  activeTab: string | null;
  onSelect: (id: string) => void;
  layout: TabLayout;
  setLayout: (update: (prev: TabLayout) => TabLayout) => void;
  onRename: (id: string, name: string) => void;
  onClose: (id: string) => void;
  /** Null until the launchable projects are known. */
  launch: LaunchProps | null;
  launchOpen: boolean;
  setLaunchOpen: (update: boolean | ((open: boolean) => boolean)) => void;
  error: string | null;
}) {
  const shown = tabs.map((t) => t.id);
  return (
    <>
      <div className="hidden md:block">
        <TerminalTabStrip
          tabs={tabs}
          activeId={activeTab}
          onSelect={onSelect}
          onClose={onClose}
          onNew={() => setLaunchOpen((open) => !open)}
          newLabel="Start an agent session"
          onRename={onRename}
          onMove={(id, target) => setLayout((l) => moveTab(l, shown, id, target))}
          onNudge={(id, by) => setLayout((l) => nudgeTab(l, shown, id, by))}
          onTogglePin={(id) => setLayout((l) => togglePin(l, id))}
          trailing={
            tabs.length > 1 ? (
              <button
                type="button"
                className={cn("ui-chip-toggle", layout.groupByProject && "ui-chip-toggle-active")}
                aria-pressed={layout.groupByProject}
                title="Keep tabs of one project next to each other"
                onClick={() => setLayout((l) => ({ ...l, groupByProject: !l.groupByProject }))}
              >
                Group by project
              </button>
            ) : undefined
          }
        />
      </div>
      {launchOpen && launch && (
        <TerminalLaunchPanel {...launch} onCancel={() => setLaunchOpen(false)} />
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
