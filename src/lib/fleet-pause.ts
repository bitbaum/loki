/**
 * Batch-pause autopilot on selected fleet projects (per-project override → off),
 * and the mirror: resume (override cleared, the project follows the fleet
 * setting again). One walk over the projects for both, so "pause everything"
 * said into a headphone and the Control button do the same rows.
 */
import { getUserProjects } from "@/db/queries/user-projects";
import { patchProject } from "@/db/queries/projects";

export type FleetPauseResult = {
  ok: boolean;
  paused: number;
  skipped: number;
  details: Array<{ projectKey: string; outcome: "paused" | "skipped"; reason?: string }>;
  message: string;
};

export async function pauseFleetProjects(
  userId: string,
  projectKeys: string[],
): Promise<FleetPauseResult> {
  return setFleetAutopilot(userId, projectKeys, "off");
}

/** Clear the per-project pause so autopilot follows the fleet setting again. */
export async function resumeFleetProjects(
  userId: string,
  projectKeys: string[],
): Promise<FleetPauseResult> {
  return setFleetAutopilot(userId, projectKeys, null);
}

async function setFleetAutopilot(
  userId: string,
  projectKeys: string[],
  override: "off" | null,
): Promise<FleetPauseResult> {
  const verb = override === "off" ? "Paused" : "Resumed";
  const details: FleetPauseResult["details"] = [];
  const projects = await getUserProjects(userId);
  const wanted = new Set(projectKeys.map((k) => k.toLowerCase()));
  let paused = 0;
  let skipped = 0;

  for (const row of projects) {
    if (!wanted.has(row.name.toLowerCase())) continue;
    if (!row.entityProjectId) {
      skipped++;
      details.push({ projectKey: row.name, outcome: "skipped", reason: "no_entity" });
      continue;
    }
    const updated = await patchProject(userId, row.entityProjectId, {
      autoInjectModeOverride: override,
    });
    if (!updated) {
      skipped++;
      details.push({ projectKey: row.name, outcome: "skipped", reason: "not_found" });
      continue;
    }
    paused++;
    details.push({ projectKey: row.name, outcome: "paused" });
  }

  const message =
    paused > 0
      ? `${verb} autopilot on **${paused}** project${paused === 1 ? "" : "s"}.`
      : `No matching projects to ${override === "off" ? "pause" : "resume"}.`;

  return { ok: paused > 0, paused, skipped, details, message };
}
