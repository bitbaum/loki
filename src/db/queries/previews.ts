import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { userProjects } from "@/db/schema";
import { isFleetInfrastructureAllowed } from "@/lib/execution-access";

export type PreviewProject = {
  userId: string;
  /** user_projects.name — also the dispatch tab. */
  name: string;
  /** entities.id — what widget tokens and owner passes are keyed by. */
  entityProjectId: string | null;
};

/**
 * The project a preview folder belongs to. A folder path is one project:
 * slugs repeat across users, folder paths cannot.
 */
export async function findPreviewProject(dirPath: string): Promise<PreviewProject | null> {
  // `dirPath` is free text any account can write, so several rows may name
  // the same preview folder — and `limit(1)` with no order let a copy decide
  // whose access code opened someone else's preview (found 2026-10-17). A
  // preview is made only by an account allowed on the fleet's machine
  // (lib/previews/create.ts); only such an account's row is its owner.
  const rows = await db
    .select({
      userId: userProjects.userId,
      name: userProjects.name,
      entityProjectId: userProjects.entityProjectId,
    })
    .from(userProjects)
    .where(eq(userProjects.dirPath, dirPath))
    .orderBy(asc(userProjects.createdAt))
    .limit(10);
  for (const row of rows) {
    if (await isFleetInfrastructureAllowed(row.userId).catch(() => false)) return row;
  }
  return null;
}
