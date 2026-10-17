/**
 * A link to one of YOUR projects by its name — loki.orangecat.ch/projects/go/petvity
 * — for every place that has to hand George a link without knowing the
 * project's id: an agent's answer, a doc, a chat message. CLAUDE.md asks for
 * a full clickable URL with every request of him; a project's id is not
 * something an agent outside his session can know, its name is.
 *
 * Pure: the route (app/(app)/projects/go/[name]) loads the projects.
 */

/** "Petvity", "petvity", " pet-vity " all name the same project. */
export function projectNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The tab to open, if it is one a project page has — never free text in a URL. */
const TABS = new Set(["now", "context", "feedback", "plan", "activity", "people", "settings"]);

export function projectGoTarget(
  projects: { name: string; entityProjectId: string | null }[],
  name: string,
  tab: string | null,
): string {
  const key = projectNameKey(name);
  const match = key
    ? projects.find((p) => p.entityProjectId && projectNameKey(p.name) === key)
    : null;
  if (!match?.entityProjectId) return "/projects";
  const hash = tab && TABS.has(tab) ? `#${tab}` : "";
  return `/projects/${match.entityProjectId}${hash}`;
}
