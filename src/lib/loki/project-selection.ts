import type { LokiProject } from "@/components/loki/types";

/** Match a project name from URL/search (case-insensitive slug). Client-safe. */
export function resolveLokiProjectSelection(
  projects: LokiProject[],
  needle: string | null | undefined,
): string[] {
  const q = needle?.trim();
  if (!q) return projects.length === 1 ? [projects[0].name] : [];
  const hit = projects.find((p) => p.name.toLowerCase() === q.toLowerCase());
  return hit ? [hit.name] : [];
}

/**
 * The scope /loki opens with: an explicit ?project=, else — for a thread opened
 * by its link (?c=, Back, a shared URL) — the projects that thread was about.
 * Only a tap in the list used to restore those, so the same thread opened from
 * its address read "No project — answers only" and work sent from it went
 * nowhere.
 */
export function initialLokiSelection(
  projects: LokiProject[],
  requested: string | null | undefined,
  thread: { projectKeys: string[] } | null | undefined,
): string[] {
  const fromUrl = resolveLokiProjectSelection(projects, requested);
  if (fromUrl.length > 0 || !thread) return fromUrl;
  return thread.projectKeys.filter((k) => projects.some((p) => p.name === k));
}
