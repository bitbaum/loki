import type { ActivityEvent } from "@/lib/activity-events";
import type { DigestWindow } from "@/db/queries/digests";
import { Section } from "@/components/ui/section-heading";
import { List, ListRow } from "@/components/ui/list-row";
import { ActivityRetryButton } from "./ActivityRetryButton";
import { activityHref, formatClockTime, type ProjectNames } from "./activity-shared";
import { NEEDS_YOU_LABELS } from "@/lib/needs-you";
import { groupFailuresByCause } from "@/lib/activity-grouping";
import { plainFailure, watchHref } from "./activity-words";

/** Past this, the list stops being triage and becomes another feed. */
const MAX_SHOWN = 3;

/**
 * The failures, above everything else, each a row with "Run again" at its
 * end. It was a red bordered card of red words, a red "Failed" badge per
 * run and the builder's own error ("no running agent for 'substrata' on
 * this runner"). Now each row says in plain words what went wrong; the dot
 * is the only red. Tapping the row opens its Watch page, where the detail is.
 *
 * Renders nothing when nothing is wrong.
 */
export function NeedsYouCard({
  events,
  digestWindow,
  projectKey,
  names,
}: {
  events: ActivityEvent[];
  digestWindow: DigestWindow;
  projectKey: string | null;
  names: ProjectNames;
}) {
  if (events.length === 0) return null;
  // One row per CAUSE: four projects failing with one sentence is one row.
  const groups = groupFailuresByCause(events);
  const shown = groups.slice(0, MAX_SHOWN);
  const titleOf = (key: string) => names[key]?.title ?? key;

  return (
    <Section
      title={NEEDS_YOU_LABELS.runs}
      link={
        groups.length > MAX_SHOWN
          ? {
              href: activityHref({ window: digestWindow, project: projectKey, filter: "attention" }),
              label: `See all ${events.length}`,
            }
          : undefined
      }
    >
      <List aria-label={NEEDS_YOU_LABELS.runs}>
        {shown.map((group) => {
          const first = group.events[0]!;
          const many = group.events.length > 1;
          const projects = [...new Set(group.events.map((e) => titleOf(e.projectKey)))];
          return (
            <ListRow
              key={first.id}
              href={watchHref(first, names)}
              status="negative"
              title={many ? `${projects.length > 1 ? projects.join(", ") : projects[0]}` : titleOf(first.projectKey)}
              secondary={`${many ? `${group.events.length} runs · ` : ""}${plainFailure(first)}`}
              trailing={formatClockTime(first.occurredAt)}
              menu={<ActivityRetryButton event={first} />}
            />
          );
        })}
      </List>
    </Section>
  );
}
