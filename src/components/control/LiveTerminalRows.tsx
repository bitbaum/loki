"use client";

import { useState } from "react";
import { Eye, Maximize2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveTabRow } from "./control-presenter";
import { PeekTabDrawer } from "./PeekTabDrawer";
import { STATE_DEFINITIONS } from "@/lib/control-states";

/** Look up the SSOT description + problem hint for a row's state. Unmatched
 *  agent terminals (stateKey === null, "Open" rows) get a generic description
 *  honest about what we know: only that a tab exists. */
function rowStateMeta(row: LiveTabRow): {
  description: string;
  problem: (typeof STATE_DEFINITIONS)[keyof typeof STATE_DEFINITIONS]["problem"];
} {
  if (row.stateKey === null) {
    return {
      description: "Terminal tab exists but no Loki project is registered for it.",
      problem: null,
    };
  }
  return {
    description: STATE_DEFINITIONS[row.stateKey].description,
    problem: STATE_DEFINITIONS[row.stateKey].problem,
  };
}

type Props = {
  rows: LiveTabRow[];
  /** Row to visually emphasize (push-notification deep-link). */
  highlightTab?: string | null;
  closeTab: (tabName: string) => void;
  onFocusProject?: (tab: string) => void;
};

/**
 * Renders the live-tab rows in two flavors: a sortable-looking table at
 * md+ widths and a vertical card stack at smaller widths. Both are mounted
 * always — Tailwind toggles `hidden md:block` / `md:hidden`. Lives here
 * instead of inline inside LiveTerminalPanel because the dual rendering is
 * ~150 lines and obscures the panel's actual orchestration (header,
 * composer, empty states).
 *
 * The Peek button uses Fleet Runner IPC when available and otherwise falls
 * back to the runner-backed pending_commands path, so it is useful from web
 * and mobile too.
 */
export function LiveTerminalRows({ rows, highlightTab, closeTab, onFocusProject }: Props) {
  const [peekTab, setPeekTab] = useState<string | null>(null);

  const isHighlighted = (tabName: string) =>
    Boolean(highlightTab && tabName.toLowerCase() === highlightTab.toLowerCase());

  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="ui-control-live-table text-xs">
          <thead>
            <tr>
              <th className="w-40">Tab</th>
              <th className="w-20">Agent</th>
              <th className="w-32">State</th>
              <th>Activity</th>
              <th className="w-28 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.tabName}
                className={cn(isHighlighted(row.tabName) && "ui-control-live-row-highlight")}
              >
                <td className="py-0.5">
                  <span className="truncate font-medium text-text-primary" title={row.tabName}>
                    {row.tabName}
                  </span>
                  {!row.registered && (
                    <span className="ml-1.5 ui-tag ui-tag-warning text-micro">Unlinked</span>
                  )}
                </td>
                <td className="py-0.5 whitespace-nowrap text-text-secondary">
                  {row.agentLabel ?? "—"}
                </td>
                <td className="py-0.5 whitespace-nowrap">
                  <span className={row.stateTagClass} title={rowStateMeta(row).description}>
                    {row.stateLabel}
                  </span>
                </td>
                <td className="py-0.5">
                  {row.activity ? (
                    <p className="truncate text-xs text-text-secondary" title={row.activity}>
                      {row.activity}
                    </p>
                  ) : (
                    <span className="text-xs text-text-muted">—</span>
                  )}
                </td>
                <td className="py-0.5 text-right">
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      type="button"
                      onClick={() => setPeekTab(row.tabName)}
                      className="ui-icon-action p-0.5"
                      title={`Peek terminal contents of ${row.tabName}`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    {row.project && onFocusProject && (
                      <button
                        type="button"
                        onClick={() => onFocusProject(row.project!.tab)}
                        className="ui-icon-action p-0.5"
                        title={`Open ${row.tabName} project details`}
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <span className="mx-0.5 h-4 w-px self-center bg-border-subtle" aria-hidden />
                    <button
                      type="button"
                      onClick={() => closeTab(row.tabName)}
                      className="ui-icon-action-danger p-0.5"
                      title={`Close ${row.tabName}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-1.5 md:hidden">
        {rows.map((row) => (
          <div
            key={row.tabName}
            className={cn(
              "ui-control-live-card py-1.5 px-2",
              isHighlighted(row.tabName) && "ui-control-live-row-highlight",
            )}
          >
            <div className="flex items-start justify-between gap-1.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-medium text-text-primary text-sm">
                    {row.tabName}
                  </span>
                  <span className={row.stateTagClass} title={rowStateMeta(row).description}>
                    {row.stateLabel}
                  </span>
                </div>
                {row.agentLabel && (
                  <p className="mt-0.5 text-micro text-text-tertiary">{row.agentLabel}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setPeekTab(row.tabName)}
                  className="ui-icon-action p-0.5"
                  title="Peek terminal"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
                {row.project && onFocusProject && (
                  <button
                    type="button"
                    onClick={() => onFocusProject(row.project!.tab)}
                    className="ui-icon-action p-0.5"
                    title="Open project details"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <span className="mx-0.5 h-4 w-px self-center bg-border-subtle" aria-hidden />
                <button
                  type="button"
                  onClick={() => closeTab(row.tabName)}
                  className="ui-icon-action-danger p-0.5"
                  title="Close tab"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {row.activity && (
              <p className="mt-1 text-xs leading-snug text-text-secondary line-clamp-2">
                {row.activity}
              </p>
            )}
            {!row.registered && (
              <p className="mt-1 text-micro text-status-warning">Not linked to a tracked project</p>
            )}
          </div>
        ))}
      </div>

      {peekTab && (
        <PeekTabDrawer
          tab={peekTab}
          onClose={() => setPeekTab(null)}
          // "Not running" is the one state that positively knows there is no
          // PTY; everything else (offline = unknown) still tries to stream.
          agentRunning={rows.find((r) => r.tabName === peekTab)?.stateKey !== "not_running"}
        />
      )}
    </>
  );
}
