/**
 * What an agent must know about a preview folder before it finishes: the
 * folder IS the site. It is served from disk at its address, it has no
 * remote by design (docs/architecture/prospect-previews.md), and a saved
 * file is live.
 *
 * The box contract tells every agent "your work is invisible until you push"
 * — true for a repository, the opposite of true here. On 2026-10-18 an agent
 * renamed a preview, committed on a branch, then reported "the work lives
 * only on this machine — tell Loki where this preview's remote should live".
 * The change had been live since the file was saved; the owner read a
 * failure and a chore. This note rides every dispatch to a preview folder.
 *
 * Pure: paths in, a block of prose or null out.
 */
import path from "path";

export function isUnderPreviewsRoot(
  projectPath: string | null | undefined,
  root: string | null,
): boolean {
  if (!projectPath || !root) return false;
  const rel = path.relative(path.resolve(root), path.resolve(projectPath));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function previewDeliveryNote(input: {
  projectPath: string | null | undefined;
  liveUrl: string | null | undefined;
  previewsRoot: string | null;
}): string | null {
  if (!isUnderPreviewsRoot(input.projectPath, input.previewsRoot)) return null;
  const where = input.liveUrl?.trim() ? `at ${input.liveUrl.trim()}` : "at its address";
  return [
    "## Where this goes",
    "This folder is a preview site and is served straight from disk " +
      `${where}: a saved file is live the moment you save it. It has no ` +
      "remote and must not get one — do not add an origin, do not push, do " +
      "not create a repository, do not ask where the remote should live.",
    "Commit your work on the current branch so it can be seen and undone, " +
      "check the page once in the browser if you can, and finish by naming " +
      `what changed and where to look (${input.liveUrl?.trim() || "the preview address"}). ` +
      "There is no delivery step after saving.",
  ].join("\n");
}
