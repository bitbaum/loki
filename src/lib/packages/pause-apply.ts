/**
 * Carry a pause (or its lifting) to GitHub now, instead of at the next
 * 15-minute read: every open update to the paused version, in every account's
 * projects, is read again with the pauses as they now stand.
 *
 * It goes through the SAME path the timer does (./updates.ts →
 * syncProjectUpdates), with each project owner's own token picker — the pause
 * adds no second way of writing labels, so it can hold or release only what
 * the decision table says and nothing else. A project that cannot be reached
 * now is caught by the next timed read, and the person is told so.
 */
import { listOpenRequestsTo, listReleasePauses } from "@/db/queries/package-releases";
import { dbUpdateStore } from "@/db/queries/package-updates";
import { parseGithubRepo } from "@/lib/github-repo-ref";
import type { UserProject } from "@/db/schema";
import { getPackageCatalogue } from "./catalogue";
import { repoTokenPicker } from "./sync";
import { githubUpdateClient } from "./update-github";
import { syncProjectUpdates } from "./updates";

export type PauseApplied = {
  /** Projects with an open update to the version. */
  projects: number;
  /** …of which now have it held (after the re-read, as recorded). */
  held: number;
  /** …of which GitHub could not be read now. */
  failed: number;
};

/**
 * Re-apply every project's updates that move `packageName` to `version`. One
 * project's GitHub trouble never stops the rest; throws only when the
 * database cannot be read.
 */
export async function applyReleasePause(
  packageName: string,
  version: string,
): Promise<PauseApplied> {
  const [rows, pauses, catalogue] = await Promise.all([
    listOpenRequestsTo(packageName, version),
    listReleasePauses(),
    getPackageCatalogue(),
  ]);
  const projects = new Map<string, UserProject>();
  for (const r of rows) projects.set(r.project.id, r.project);
  const pickers = new Map<string, Awaited<ReturnType<typeof repoTokenPicker>>>();
  const catalogueNames = new Set(catalogue.packages.map((p) => p.name));
  let failed = 0;
  for (const project of projects.values()) {
    const ref = parseGithubRepo(project.gitUrl);
    if (!ref) {
      failed++;
      continue;
    }
    let tokenFor = pickers.get(project.userId);
    if (!tokenFor) {
      tokenFor = await repoTokenPicker(project.userId);
      pickers.set(project.userId, tokenFor);
    }
    const out = await syncProjectUpdates({
      userId: project.userId,
      project,
      ref,
      catalogueNames,
      gh: githubUpdateClient(tokenFor(project, ref)),
      store: dbUpdateStore,
      now: new Date(),
      pauses,
    }).catch(() => ({ error: "failed" }));
    if ("error" in out && out.error) failed++;
  }
  const after = await listOpenRequestsTo(packageName, version).catch(() => rows);
  const heldProjects = new Set(
    after.filter((r) => r.request.state === "held").map((r) => r.project.id),
  );
  return { projects: projects.size, held: heldProjects.size, failed };
}
