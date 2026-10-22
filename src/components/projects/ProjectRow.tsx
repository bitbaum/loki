import { ListRow, RowInitial } from "@/components/ui/list-row";
import { projectTitle } from "@/lib/project-display";
import { projectListLine, projectListTrailing, type ProjectRunNow } from "@/lib/project-list-line";
import type { ProjectGridRow } from "./project-grid-row";

/**
 * THE project row — a ListRow, like every other collection in the app (design
 * reset rule 3, docs/development/design-reset-2026-10.md).
 *
 * An initial, the project's name, ONE line saying how it is ("Building now",
 * "Live", "Needs you: 3 notes"), and when an agent last
 * worked on it. That is all. The row it replaces carried stage capitals,
 * "Not connected" in orange, "8 of 10 checks", "last run …" and "8 feedback"
 * on every project — the owner's "Frankenstein element" (2026-10-21). Checks,
 * stage and counts are on the project page, one tap away; the words come from
 * lib/project-list-line.ts, where the order of what wins is written down.
 */
export function ProjectRow({
  project,
  lastDispatchAt,
  newNotes = 0,
  runNow = null,
  nowMs,
  secondary,
}: {
  project: ProjectGridRow;
  /** Newest agent run for this project, ISO — null = never. */
  lastDispatchAt?: string | null;
  /** Notes from the site nobody has looked at yet. */
  newNotes?: number;
  runNow?: ProjectRunNow | null;
  nowMs?: number;
  /** Say something else under the name (an archived copy says so). */
  secondary?: string;
}) {
  const title = projectTitle(project);
  const line = projectListLine(project, { lastRunAt: lastDispatchAt, newNotes, runNow });
  return (
    <ListRow
      href={`/projects/${project.id}`}
      avatar={<RowInitial name={title} />}
      title={title}
      secondary={secondary ?? (project.readonly ? `Shared with you · ${line.text}` : line.text)}
      status={secondary ? undefined : (line.tone ?? undefined)}
      trailing={projectListTrailing(lastDispatchAt, nowMs)}
    />
  );
}
