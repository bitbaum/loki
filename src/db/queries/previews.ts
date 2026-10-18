import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { entities, userProjects } from "@/db/schema";
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

/**
 * A preview moved to a new folder and address, and perhaps a new name: the
 * project row follows it (folder, address, slug, name) and so does the
 * project's name everywhere it is shown. One transaction, so a project is never
 * half moved. False when the folder is not this owner's preview.
 */
export async function movePreviewProject(
  userId: string,
  fromDir: string,
  to: { dirPath: string; slug: string; liveUrl: string; name: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(userProjects)
      .set({ ...to, updatedAt: new Date() })
      .where(and(eq(userProjects.dirPath, fromDir), eq(userProjects.userId, userId)))
      .returning({ entityProjectId: userProjects.entityProjectId });
    if (!row) return false;
    if (row.entityProjectId)
      await tx
        .update(entities)
        .set({ name: to.name, updatedAt: new Date() })
        .where(and(eq(entities.id, row.entityProjectId), eq(entities.userId, userId)));
    return true;
  });
}
