import { CrewWorkspace } from "@/components/crew/CrewWorkspace";
import { getCrewSummary, listCrew } from "@/db/queries/crew";
import { listHumanTasks } from "@/db/queries/human-tasks";
import { getProjects } from "@/db/queries/projects";
import { projectTitle } from "@/lib/project-display";
import { requirePageUserId } from "@/lib/session";

export const metadata = { title: "Crew" };

/**
 * Crew lives in the private zone, beside People, because the roster IS the
 * operator's own address book put to work. Assignments leave that zone only
 * through a share link, one at a time, and only when handed over on purpose.
 */
export default async function CrewPage() {
  const userId = await requirePageUserId();
  const [tasks, crew, summary, projects] = await Promise.all([
    listHumanTasks(userId),
    listCrew(userId),
    getCrewSummary(userId),
    getProjects(userId),
  ]);

  return (
    <CrewWorkspace
      initialTasks={tasks}
      initialCrew={crew}
      initialSummary={summary}
      projects={projects.map((p) => ({ id: p.id, name: projectTitle(p) }))}
    />
  );
}
