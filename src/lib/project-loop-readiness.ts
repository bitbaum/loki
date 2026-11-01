import type { AutoInjectMode } from "@/config/beacon";

export type LoopReadableProject = {
  dir?: string | null;
  dirPath?: string | null;
  readonly?: boolean;
  autoInjectModeOverride?: AutoInjectMode | null;
};

export type ProjectLoopReadiness =
  | {
      state: "ready";
      label: "Ready for agents";
      tone: "positive";
      reason: "has_path";
      description: string;
    }
  | {
      state: "blocked";
      label: "Not connected";
      tone: "warning";
      reason: "no_path";
      description: string;
    }
  | {
      state: "paused";
      label: "Autopilot paused";
      tone: "warning";
      reason: "project_paused" | "fleet_paused";
      description: string;
    };

export function projectExecutionPath(project: LoopReadableProject): string | null {
  const path = project.dirPath ?? project.dir ?? null;
  const trimmed = path?.trim();
  return trimmed ? trimmed : null;
}

export function deriveProjectLoopReadiness(
  project: LoopReadableProject,
  inheritedMode: AutoInjectMode = "on",
): ProjectLoopReadiness {
  if (!projectExecutionPath(project)) {
    return {
      state: "blocked",
      // Plain words (owner's walk-through, 2026-10-17): "NEEDS PATH" on every
      // project told a non-technical person nothing.
      label: "Not connected",
      tone: "warning",
      reason: "no_path",
      description: "Connect a folder or code repository so an agent can work on this project.",
    };
  }

  if (project.autoInjectModeOverride === "off") {
    return {
      state: "paused",
      label: "Autopilot paused",
      tone: "warning",
      reason: "project_paused",
      description: "Automatic continuation is paused for this project.",
    };
  }

  if (inheritedMode === "off") {
    return {
      state: "paused",
      label: "Autopilot paused",
      tone: "warning",
      reason: "fleet_paused",
      description: "Fleet autopilot is paused globally.",
    };
  }

  return {
    state: "ready",
    label: "Ready for agents",
    tone: "positive",
    reason: "has_path",
    description:
      "This project is connected, so an agent can work on it whenever a runner is online.",
  };
}
