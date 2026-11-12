import Link from "next/link";
import type { ActivityEvent, ActivityFilter } from "@/lib/activity-events";
import type { DigestWindow } from "@/db/queries/digests";
import { Section } from "@/components/ui/section-heading";
import { List, ListRow } from "@/components/ui/list-row";
import { NeedsYouRow } from "./NeedsYouRow";
import { activityHref, titleFor, type ProjectNames } from "./activity-shared";
import { NEEDS_YOU_LABELS } from "@/lib/needs-you";
import { groupFailuresByCause } from "@/lib/activity-grouping";
import { isCapacityFailure, plainFailure, watchHref } from "./activity-words";

/** Past this, the list stops being triage and becomes another feed. */
const MAX_SHOWN = 3;

/**
 * The failures, above everything else, each a row with "Run again" at its
 * end. It was a red bordered card of red words, a red "Failed" badge per
 * run and the builder's own error ("no running agent for 'substrata' on
 * this runner"). Now each row says in plain words what went wrong; the dot
 * is the only red. Tapping the row opens its Watch page, where the detail is.
 *
 * Renders nothing when nothing is wrong, and nothing on the "Needs you"
 * filter: the list below is then the same failures, and "See all" pointed at
 * the page it was on (2026-11-12).
 */
export function NeedsYouCard({
  events,
  digestWindow,
  projectKey,
  names,
  filter,
}: {
  events: ActivityEvent[];
  filter: ActivityFilter;
  digestWindow: DigestWindow;
  projectKey: string | null;
  names: ProjectNames;
}) {
  if (events.length === 0 || filter === "attention") return null;
  // One row per CAUSE: four projects failing with one sentence is one row.
  const groups = groupFailuresByCause(events);
  const shown = groups.slice(0, MAX_SHOWN);
  const titleOf = (key: string) => titleFor(names, key);

  return (
    <Section
      title={NEEDS_YOU_LABELS.runs}
      link={
        groups.length > MAX_SHOWN
          ? {
              href: activityHref({
                window: digestWindow,
                project: projectKey,
                filter: "attention",
              }),
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
          const title = projects.join(", ");
          const secondary = `${many ? `${group.events.length} runs · ` : ""}${plainFailure(first)}`;
          // A full builder is not fixed by sending more to it: the way forward
          // is to see what is holding it. On 2026-11-12 "8 runs · already as
          // many as it runs at once" sat next to a "Run again" that resent one.
          if (isCapacityFailure(first))
            return (
              <ListRow
                key={first.id}
                href={watchHref(first, names)}
                status="negative"
                title={title}
                secondary={secondary}
                menu={
                  <Link
                    href={activityHref({
                      window: digestWindow,
                      project: projectKey,
                      filter: "running",
                    })}
                    className="ui-row-verb"
                  >
                    See what&apos;s running
                  </Link>
                }
              />
            );
          return (
            <NeedsYouRow
              key={first.id}
              event={first}
              href={watchHref(first, names)}
              title={title}
              secondary={secondary}
              // The button resends ONE run; with several projects in the row
              // it says which.
              retryLabel={
                projects.length > 1 ? `Run ${titleOf(first.projectKey)} again` : undefined
              }
            />
          );
        })}
      </List>
    </Section>
  );
}
