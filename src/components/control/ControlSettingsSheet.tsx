"use client";

import { Loader2, RefreshCw, Zap } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/dates";
import type { AutoInjectMode } from "@/config/beacon";
import { AutomationPolicyControl } from "./AutomationPolicyControl";

/**
 * Fleet settings — the controls that used to shout from the top of Control.
 *
 * Autopilot lived in the hero as a full-width, high-contrast "Pause fleet"
 * button with a two-sentence explanation under it. Measured against how often
 * a builder actually pauses their fleet, that made the loudest control on the
 * page one of the rarest actions in the product, directly above the counters
 * it was drowning out. Refresh sat next to it, competing with a poller that
 * already refreshes on its own.
 *
 * These are settings: chosen deliberately, changed rarely, and never read
 * while work is in flight. A sheet is where settings go. What stays on the
 * page is what changes on its own — and the fleet's mode is still visible
 * there, in the hero's headline, because the pulse already reports "Paused"
 * when it is. The control moved; the state never left.
 */

// The explanation belongs with the control it explains. It used to render on
// Control itself, permanently, for a setting that changes about once a month.
const AUTOMATION_HINTS: Record<AutoInjectMode, { primary: string; secondary?: string }> = {
  off: { primary: "Agents stop when a task ends. You dispatch every next step yourself." },
  on: {
    primary:
      "Agents work through each project's queue; overnight Loki builds from your feedback under the run budget and reads one site.",
    secondary: "Busy agents, blockers, and failing health checks still pause dispatch.",
  },
};

export function ControlSettingsSheet({
  onClose,
  automationMode,
  automationModeLoaded,
  automationSaving,
  onAutomationChange,
  refreshing,
  onRefresh,
  lastUpdated,
  runnerLabel,
  runnerDetail,
  versionDetail,
}: {
  onClose: () => void;
  automationMode: AutoInjectMode;
  automationModeLoaded: boolean;
  automationSaving: boolean;
  onAutomationChange: (mode: AutoInjectMode) => void;
  refreshing: boolean;
  onRefresh: () => void;
  lastUpdated: number | null;
  /** Compact builder state, e.g. "Cloud + this computer online". */
  runnerLabel: string;
  /** Sync age and presence. */
  runnerDetail: string | null;
  /** Build versions — diagnostics, which is exactly what a settings sheet is
   *  for and exactly why they no longer lead the phone's first line. */
  versionDetail: string | null;
}) {
  return (
    <Modal onClose={onClose} position="bottom-mobile" padded={false} size="md" className="ui-sheet">
      <div className="ui-sheet-grip" aria-hidden="true" />
      <div className="ui-sheet-body">
        <section className="ui-sheet-section">
          <h3 className="ui-sheet-label">Autopilot</h3>
          <div className="ui-sheet-row">
            <span className="min-w-0 flex-1 text-sm text-text-secondary">
              {automationModeLoaded ? (automationMode === "on" ? "On" : "Off") : "Checking…"}
            </span>
            <AutomationPolicyControl
              mode={automationMode}
              saving={automationSaving}
              onChange={onAutomationChange}
              variant="hero"
            />
          </div>
          {/* Don't state the mode until the server has confirmed it — the
              client seeds "on" optimistically, so a paused fleet used to read
              "Autopilot on" until the fetch landed, or forever if it failed. */}
          <p className="ui-sheet-hint">
            <Zap className="mr-1 inline h-3 w-3 text-accent-text" aria-hidden="true" />
            {automationModeLoaded
              ? [
                  AUTOMATION_HINTS[automationMode].primary,
                  AUTOMATION_HINTS[automationMode].secondary,
                ]
                  .filter(Boolean)
                  .join(" ")
              : "Checking autopilot setting…"}
          </p>
        </section>

        <section className="ui-sheet-section">
          <h3 className="ui-sheet-label">Builder</h3>
          <p className="ui-sheet-value">{runnerLabel}</p>
          {runnerDetail && <p className="ui-sheet-hint">{runnerDetail}</p>}
          {versionDetail && <p className="ui-sheet-hint">{versionDetail}</p>}
          <div className="ui-sheet-row">
            <span className="min-w-0 flex-1 text-sm text-text-secondary">
              {lastUpdated ? `Page data ${timeAgo(lastUpdated)}` : "Page data not loaded yet"}
            </span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="ui-btn-secondary ui-btn-sm"
            >
              {refreshing ? (
                <Loader2 className="ui-spinner-xs" />
              ) : (
                <RefreshCw className={cn("h-3.5 w-3.5")} aria-hidden="true" />
              )}
              Refresh
            </button>
          </div>
        </section>
      </div>

      <div className="ui-sheet-foot">
        <button type="button" className="ui-btn-secondary w-full" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
