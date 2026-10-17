/**
 * The engineer's account for a project that is a preview folder. A repository
 * project's account comes from its pull request (lib/feedback/fix-note); a
 * preview has no pull request, so its build leaves the same account in
 * improvements.json, and the watch page reads it from the folder.
 */
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import type { FixNote } from "@/lib/feedback/fix-note";
import { readImprovements } from "@/lib/previews/folder";
import { walkthroughFrom } from "@/lib/previews/improvements";
import { isPreviewDir } from "@/lib/previews/root";

export async function previewWalkthrough(
  userId: string,
  projectId: string,
): Promise<FixNote | null> {
  const registered = await getUserProjectByEntityId(userId, projectId).catch(() => null);
  if (!registered?.dirPath || !isPreviewDir(registered.dirPath)) return null;
  return walkthroughFrom(await readImprovements(registered.dirPath));
}
