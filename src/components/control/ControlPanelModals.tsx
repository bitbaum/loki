"use client";

import type { ComponentProps } from "react";
import { builderCompactLabel } from "@/lib/builder-presence";
import { deriveRunnerStateKey } from "@/lib/control-states";
import { timeAgo } from "@/lib/dates";
import type { ControlData } from "@/lib/control-types";
import { BootstrapModal } from "./BootstrapModal";
import { ControlSettingsSheet } from "./ControlSettingsSheet";
import { LaunchTabModal, NewProjectModal } from "./control-panel-modals";

type FleetSettingsProps = {
  onClose: () => void;
  automationPolicy: {
    mode: ComponentProps<typeof ControlSettingsSheet>["automationMode"];
    loaded: boolean;
    saving: boolean;
  };
  onAutomationChange: ComponentProps<typeof ControlSettingsSheet>["onAutomationChange"];
  refreshing: boolean;
  onRefresh: () => void;
  lastUpdated: number | null;
  runnerNeverSeen: boolean;
  runnerOffline: boolean;
  runnerVersion: string | null;
  runnerLastPushedAt: string | null;
  builderPresence: ControlData["builderPresence"];
  builderVersions: ControlData["builderVersions"];
};

/**
 * Every overlay Control can open, in one place.
 *
 * They are all conditional siblings of the page body and none of them belongs
 * to the four-tier ordering the page's return is organised around — keeping
 * them inline pushed ~90 lines of modal wiring between the last section and
 * the page's own toast.
 */
export function ControlPanelModals({
  fleetSettings,
  bootstrap,
  newProject,
  launch,
}: {
  fleetSettings: FleetSettingsProps | null;
  bootstrap: ComponentProps<typeof BootstrapModal> | null;
  newProject: ComponentProps<typeof NewProjectModal> | null;
  launch: ComponentProps<typeof LaunchTabModal> | null;
}) {
  return (
    <>
      {fleetSettings && <FleetSettingsSheet {...fleetSettings} />}
      {bootstrap && <BootstrapModal {...bootstrap} />}
      {newProject && <NewProjectModal {...newProject} />}
      {launch && <LaunchTabModal {...launch} />}
    </>
  );
}

/** The builder label and version line the settings sheet shows, derived from
 *  the same presence facts the hero reads. */
function FleetSettingsSheet({
  onClose,
  automationPolicy,
  onAutomationChange,
  refreshing,
  onRefresh,
  lastUpdated,
  runnerNeverSeen,
  runnerOffline,
  runnerVersion,
  runnerLastPushedAt,
  builderPresence,
  builderVersions,
}: FleetSettingsProps) {
  return (
    <ControlSettingsSheet
      onClose={onClose}
      automationMode={automationPolicy.mode}
      automationModeLoaded={automationPolicy.loaded}
      automationSaving={automationPolicy.saving}
      onAutomationChange={onAutomationChange}
      refreshing={refreshing}
      onRefresh={onRefresh}
      lastUpdated={lastUpdated}
      runnerLabel={builderCompactLabel(
        deriveRunnerStateKey({
          neverSeen: runnerNeverSeen,
          offline: runnerOffline,
          stateUnknown: runnerNeverSeen,
        }),
        runnerVersion,
        builderPresence,
      )}
      runnerDetail={
        runnerLastPushedAt && !runnerNeverSeen
          ? `Builder sync ${timeAgo(new Date(runnerLastPushedAt).getTime())}`
          : null
      }
      versionDetail={
        [
          builderVersions?.cloud ? `cloud v${builderVersions.cloud.replace(/^box-/, "")}` : null,
          builderVersions?.local ? `app v${builderVersions.local.replace(/^box-/, "")}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || null
      }
    />
  );
}
