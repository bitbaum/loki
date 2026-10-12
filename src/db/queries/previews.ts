import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userProjects } from "@/db/schema";

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
  const [row] = await db
    .select({
      userId: userProjects.userId,
      name: userProjects.name,
      entityProjectId: userProjects.entityProjectId,
    })
    .from(userProjects)
    .where(eq(userProjects.dirPath, dirPath))
    .limit(1);
  return row ?? null;
}
