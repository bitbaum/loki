import { after } from "next/server";
import { createProject } from "@/db/queries/projects";
import { findProjectEntityByName } from "@/db/queries/project-merge";
import { scheduleProjectProfileReindexByEntityId } from "@/lib/rag/reindex-project-profile";
import { SOURCE_LOKI_UI } from "@/lib/constants";
import { startServerKickoff, getServerKickoff } from "@/lib/kickoff/server-runs";
import { KICKOFF_STEPS } from "@/lib/project-kickoff";
import type { KickoffInput } from "@/lib/kickoff/orchestrate";

/**
 * Create (or resume) a project from a written brief and start its kickoff.
 * Shared by every "say it, and Loki builds it" intake: /change starts from a
 * website, /take from an open-source repository.
 *
 * `name` must be derived from the request id, so repeated delivery of one
 * request resumes its project instead of creating a second repo.
 */
export async function startBriefProject(
  userId: string,
  opts: { name: string; source: string; template?: KickoffInput["template"] },
): Promise<{ projectPath: string } | null> {
  let project = await findProjectEntityByName(userId, opts.name);
  const existing = Boolean(project);
  if (!project) {
    try {
      const created = await createProject(
        userId,
        { name: opts.name, description: opts.source },
        SOURCE_LOKI_UI,
      );
      project = await findProjectEntityByName(userId, created.name);
      scheduleProjectProfileReindexByEntityId(userId, created.id);
    } catch (error) {
      // A second tab may have won the insert; only join this user's exact name.
      project = await findProjectEntityByName(userId, opts.name);
      if (!project) throw error;
    }
  }
  if (!project) return null;
  // A retry of an accepted start must not put a second agent on a completed
  // project. The dossier already carries its progress and next action.
  if (!existing && !getServerKickoff(userId, project.id)) {
    const { done } = startServerKickoff(userId, {
      projectId: project.id,
      names: [project.name],
      plan: [...KICKOFF_STEPS],
      source: opts.source,
      visibility: "private",
      template: opts.template,
    });
    after(() => done);
  }
  return { projectPath: `/projects/${project.id}/watch` };
}
