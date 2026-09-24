"use client";

import { useMemo, useState, type RefObject } from "react";
import { PanelsTopLeft, RefreshCw, Terminal, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/api/fetch";
import { FEEDBACK_SHORT_MS, REFRESH_AFTER_TAB_ACTION_MS } from "@/lib/constants/timings";
import type { LiveTabRow } from "./control-presenter";
import { Modal } from "@/components/ui/modal";
import { LiveTerminalRows } from "./LiveTerminalRows";
import { useInsideFleetRunner } from "@/hooks/use-inside-fleet-runner";
import { TerminalComposer } from "@/components/terminal/TerminalComposer";

export function LiveTerminalPanel({
  rows,
  openTabCount,
  runnerNeverSeen,
  runnerSyncStale = false,
  refreshing,
  onRefresh,
  onFocusProject,
  highlightTab,
  initialTargetTab,
  panelRef,
  embedded = false,
}: {
  rows: LiveTabRow[];
  /** Total open agent terminals the builders reported, including ones this
   *  panel filters out (tabs that match no registered project). Without it
   *  the caption claimed to list every open terminal while silently hiding
   *  them. */
  openTabCount?: number;
  runnerNeverSeen: boolean;
  runnerSyncStale?: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onFocusProject?: (tab: string) => void;
  /** Row to visually emphasize (e.g. from a push notification deep-link). */
  highlightTab?: string | null;
  /** Pre-select this tab in the prompt composer. */
  initialTargetTab?: string | null;
  panelRef?: RefObject<HTMLElement | null>;
  /** Strip outer chrome when nested inside a parent shell (mobile details). */
  embedded?: boolean;
}) {
  const insideRunner = useInsideFleetRunner();
  const [targetTab, setTargetTab] = useState(initialTargetTab || "");

  // Deep-link updates (e.g. a push notification while the panel is mounted)
  // re-point the composer. Guarded render-time adjustment instead of an
  // effect; the mount case is covered by the useState initializer above.
  const [prevInitialTarget, setPrevInitialTarget] = useState(initialTargetTab);
  if (initialTargetTab !== prevInitialTarget) {
    setPrevInitialTarget(initialTargetTab);
    if (initialTargetTab) setTargetTab(initialTargetTab);
  }
  const tabOptions = useMemo(() => rows.map((row) => row.tabName), [rows]);
  const hiddenTabCount = Math.max(0, (openTabCount ?? rows.length) - rows.length);
  const effectiveTarget = targetTab || tabOptions[0] || "";

  // Confirmation runs through <Modal>, never window.confirm — a native dialog
  // blocks the whole renderer (frozen page for remote/automation sessions).
  const [confirmCloseTab, setConfirmCloseTab] = useState<string | null>(null);
  const closeTab = (tabName: string) => setConfirmCloseTab(tabName);

  const reallyCloseTab = async (tabName: string) => {
    setConfirmCloseTab(null);
    try {
      const res = await postJson("/api/control/close-tab", { tab: tabName });
      if (res.ok) setTimeout(onRefresh, REFRESH_AFTER_TAB_ACTION_MS);
    } catch {
      /* best effort */
    }
  };

  const repairHelper = async () => {
    try {
      const res = await postJson("/api/agent/repair-helper", {});
      if (res.ok) setTimeout(onRefresh, FEEDBACK_SHORT_MS);
    } catch {
      /* best effort */
    }
  };

  return (
    <section
      ref={panelRef}
      className={cn("ui-control-live-panel", embedded && "ui-control-live-panel-embedded")}
    >
      <div className="ui-control-live-panel-header py-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <PanelsTopLeft className="h-3.5 w-3.5 shrink-0 text-accent-text" />
            {/* When embedded the parent <summary> already renders the
                "Workspaces · N tabs" label — suppress the inner heading and
                count so the same facts don't appear twice on the page. */}
            {!embedded && (
              <>
                <h2 className="text-xs font-semibold text-text-primary">Terminal workspaces</h2>
                <span className="ui-tag ui-tag-neutral text-micro">
                  {runnerNeverSeen
                    ? "offline"
                    : runnerSyncStale
                      ? `${rows.length} tabs · sync stale`
                      : `${rows.length} tabs`}
                </span>
              </>
            )}
          </div>
          {!runnerNeverSeen && (
            <p className="mt-0.5 text-micro text-text-tertiary">
              {runnerSyncStale
                ? "Showing last-known workspace state — Fleet Runner sync is stale."
                : hiddenTabCount > 0
                  ? `Tabs whose name matches a registered project (${rows.length} of ${openTabCount} open). Agents in unnamed or unmatched tabs run unseen here — their dispatches still show on the project cards.`
                  : "Tabs whose name matches a registered project. Agents in unnamed or unmatched tabs run unseen here — their dispatches still show on the project cards."}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Repair queues a command for the local runtime to pick up — with
              sync stale there is nothing listening, so offering "Restart
              helper" would silently no-op. The offline banner owns recovery. */}
          {!runnerNeverSeen && !runnerSyncStale && (
            <button
              type="button"
              onClick={repairHelper}
              className="ui-btn-ghost ui-btn-xs gap-1 text-micro"
              title="Re-install / repair the local helper"
            >
              <Wrench className="h-3 w-3" />
              <span className="hidden sm:inline">Restart helper</span>
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="ui-btn-ghost ui-btn-xs gap-1 text-micro"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {runnerNeverSeen ? (
        <div className="ui-control-live-empty">
          <div className="mb-2 text-text-tertiary">
            <Terminal className="mx-auto h-6 w-6" />
          </div>
          <p className="font-medium text-text-secondary">No live workspace data — yet</p>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-tertiary">
            The cloud can&apos;t see the agent terminals on your machine until Fleet Runner pushes
            state to it.
          </p>
          {/* Fleet Runner is the only local runtime — the bash runner was
              deleted 2026-06-11 (killing-the-bash-daemon, Session 4b). Inside
              the desktop app there's nothing to download: the user just needs
              to pair (banner above), so don't show a circular download link. */}
          {insideRunner ? (
            <p className="mt-3 text-xs text-text-tertiary">
              You&apos;re running Fleet Runner — pair it from the banner above (or Settings → Agent
              tokens) and your workspaces appear here within 30s.
            </p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm">
                <a
                  href="https://github.com/bitbaum/loki-releases/releases/latest"
                  target="_blank"
                  rel="noreferrer"
                  className="ui-btn-primary"
                >
                  Download Fleet Runner (desktop app)
                </a>
              </div>
              <p className="mt-3 text-xs text-text-tertiary">
                Fleet Runner auto-mints a token from your signed-in session — install, launch, your
                workspaces appear here within 30s.
              </p>
            </>
          )}
        </div>
      ) : rows.length === 0 ? (
        <div className="ui-control-live-empty">
          <div className="mb-2 text-text-tertiary">
            <Terminal className="mx-auto h-6 w-6" />
          </div>
          <p className="font-medium text-text-secondary">No terminal workspaces open</p>
          <p className="mt-1 text-sm text-text-tertiary">
            Launch an agent from a project to open its terminal workspace.
          </p>
        </div>
      ) : (
        <>
          {/* Quick send to any open tab — THE composer (the same one the
              terminal and Loki chat use), aimed by the picker above it. It was
              a one-line input that sent on ⌘Enter and nothing else. */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-micro text-text-tertiary">
              <span className="shrink-0">Send to</span>
              <select
                value={effectiveTarget}
                onChange={(event) => setTargetTab(event.target.value)}
                className="ui-control-live-select"
                aria-label="Target agent terminal"
              >
                {tabOptions.map((tab) => (
                  <option key={tab} value={tab}>
                    {tab}
                  </option>
                ))}
              </select>
            </label>
            <TerminalComposer
              key={effectiveTarget}
              tab={effectiveTarget || null}
              density="compact"
              injectPlaceholder={`Quick send to ${effectiveTarget} — it needs a running agent there`}
              onInjected={() => setTimeout(onRefresh, REFRESH_AFTER_TAB_ACTION_MS)}
            />
          </div>

          <LiveTerminalRows
            rows={rows}
            highlightTab={highlightTab}
            closeTab={closeTab}
            onFocusProject={onFocusProject}
          />
        </>
      )}

      {confirmCloseTab !== null && (
        <Modal onClose={() => setConfirmCloseTab(null)} size="sm">
          <h3 className="text-sm font-semibold text-text-primary">Close workspace tab?</h3>
          <p className="text-sm text-text-secondary">
            This closes the agent terminal{" "}
            <span className="font-medium text-text-primary">{confirmCloseTab}</span> that Fleet
            Runner owns on your computer. The agent running in it is stopped.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmCloseTab(null)}
              className="ui-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => reallyCloseTab(confirmCloseTab)}
              className="ui-btn-danger"
            >
              Close tab
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
