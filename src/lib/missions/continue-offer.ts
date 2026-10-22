/**
 * Present one truthful next action for a Mission without creating a second
 * dispatch implementation. The actual POST always goes through the canonical
 * /api/projects/[id]/dispatch route and its authorization/execution gates.
 */
import type { BuildStatus } from "@/lib/project-build-status";
import type { ProjectDispatchKind } from "@/lib/project-dispatch";

export type MissionContinueOffer =
  | { type: "dispatch"; kind: Extract<ProjectDispatchKind, "next_step" | "kickoff"> }
  | { type: "watch"; reason: "building" | "queued" | "needs_you" | "stalled" }
  | { type: "setup"; reason: "no_repo" | "no_brief" }
  | { type: "read_only" };

export function missionContinueOffer(input: {
  canEdit: boolean;
  buildStatus: Pick<BuildStatus, "kind">["kind"];
  hasRepo: boolean;
  hasQueuedNextStep: boolean;
  hasBriefOrGoals: boolean;
}): MissionContinueOffer {
  if (!input.canEdit) return { type: "read_only" };
  // Do not queue duplicates into a busy, blocked, or stale session.
  if (input.buildStatus !== "idle") return { type: "watch", reason: input.buildStatus };
  if (!input.hasRepo) return { type: "setup", reason: "no_repo" };
  if (input.hasQueuedNextStep) return { type: "dispatch", kind: "next_step" };
  if (input.hasBriefOrGoals) return { type: "dispatch", kind: "kickoff" };
  return { type: "setup", reason: "no_brief" };
}
