import { after } from "next/server";
import { createProject } from "@/db/queries/projects";
import { findProjectEntityByName } from "@/db/queries/project-merge";
import { scheduleProjectProfileReindexByEntityId } from "@/lib/rag/reindex-project-profile";
import { SOURCE_LOKI_UI } from "@/lib/constants";
import { startServerKickoff, getServerKickoff } from "@/lib/kickoff/server-runs";
import { KICKOFF_STEPS } from "@/lib/project-kickoff";
import type { KickoffInput } from "@/lib/kickoff/orchestrate";
import {
  findBriefProject,
  isProjectNameTaken,
  markBriefProject,
} from "@/db/queries/brief-projects";
import { firstFreeName } from "@/lib/brief-project-name";

/** One start per request at a time (two tabs, a double tap): the second waits
 *  for the first and then finds its project instead of naming a second one. */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Create (or resume) a project from a written brief and start its kickoff.
 * Shared by every "say it, and Loki builds it" intake: /change starts from a
 * website, /take from an open-source repository.
 *
 * `name` is the READABLE name wanted (the site's own name, e.g. "xhiva"); the
 * first free one of name, name-2, … is used, because the name becomes the repo
 * and the <name>.orangecat.ch preview. `requestId` is the duplicate-submit
 * guard: repeated delivery of one request resumes its project, never a second
 * repo. It used to be baked into the name, which is how previews ended up at
 * xhiva-art-refresh-300d1519783b47d3ab1c7ddb77c5febf.orangecat.ch.
 */
export async function startBriefProject(
  userId: string,
  opts: { name: string; requestId: string; source: string; template?: KickoffInput["template"] },
): Promise<{ projectPath: string } | null> {
  const key = `${userId}:${opts.requestId}`;
  const prior = inFlight.get(key);
  if (prior) await prior.catch(() => undefined);
  const run = startBriefProjectOnce(userId, opts);
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    if (inFlight.get(key) === run) inFlight.delete(key);
  }
}

async function startBriefProjectOnce(
  userId: string,
  opts: { name: string; requestId: string; source: string; template?: KickoffInput["template"] },
): Promise<{ projectPath: string } | null> {
  let project = await findBriefProject(userId, opts.requestId);
  const existing = Boolean(project);
  if (!project) {
    const name = await firstFreeName(opts.name, isProjectNameTaken);
    const created = await createProject(userId, { name, description: opts.source }, SOURCE_LOKI_UI);
    await markBriefProject(
      created.id,
      opts.requestId,
      opts.template === "bare" ? "repo-copy" : "website",
    );
    project = await findProjectEntityByName(userId, created.name);
    scheduleProjectProfileReindexByEntityId(userId, created.id);
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
