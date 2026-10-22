import {
  filterActivityEvents,
  groupEventsByDay,
  tallyActivityEvents,
  type ActivityEvent,
  type ActivityFilter,
} from "@/lib/activity-events";
import type { DigestWindow } from "@/db/queries/digests";
import { Section } from "@/components/ui/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow } from "@/components/ui/list-row";
import { projectTally, splitBareDispatches } from "@/lib/activity-grouping";
import { ActivityShowMenu } from "./ActivityScope";
import { formatClockTime, formatDayHeading, titleFor, type ProjectNames } from "./activity-shared";
import { eventLine, watchHref } from "./activity-words";

const SHOW_LABEL: Record<ActivityFilter, string> = {
  all: "Everything",
  attention: "Needs you",
  running: "Running",
  queued: "Waiting",
  done: "Done",
};

/**
 * What happened, as rows under day headings: the project, one line saying
 * how it went and what came of it, the time. Each opens the run on its
 * project's Watch page. It was a bordered card holding a count, a sentence
 * explaining the card, a scrolling row of count chips and rows of four
 * stacked lines with a coloured badge each.
 */
export function EventStream({
  events,
  filter,
  digestWindow,
  projectKey,
  names,
}: {
  events: ActivityEvent[];
  filter: ActivityFilter;
  digestWindow: DigestWindow;
  projectKey: string | null;
  names: ProjectNames;
}) {
  const tallies = tallyActivityEvents(events);
  const visible = filterActivityEvents(events, filter);
  const groups = groupEventsByDay(visible);
  const titleOf = (key: string) => titleFor(names, key);
  const count: Record<ActivityFilter, number> = {
    all: tallies.total,
    attention: tallies.attention,
    running: tallies.running,
    queued: tallies.queued,
    done: tallies.done,
  };
  // A bucket with nothing in it is not offered — except the one you are on.
  const options = (Object.keys(SHOW_LABEL) as ActivityFilter[])
    .filter((f) => f === "all" || f === filter || count[f] > 0)
    .map((f) => ({ value: f, label: `${SHOW_LABEL[f]} (${count[f]})` }));

  const row = (event: ActivityEvent) => (
    <ListRow
      key={event.id}
      href={watchHref(event, names)}
      // Red is the only colour here: running is not something to act on.
      status={event.status === "negative" ? "negative" : undefined}
      title={titleOf(event.projectKey)}
      secondary={eventLine(event)}
      trailing={formatClockTime(event.occurredAt)}
    />
  );

  return (
    <Section
      title="What happened"
      right={
        <ActivityShowMenu
          window={digestWindow}
          project={projectKey}
          filter={filter}
          options={options}
        />
      }
    >
      {visible.length === 0 ? (
        <EmptyState>
          {filter === "attention"
            ? "Nothing needs you in this window."
            : filter === "running"
              ? "Nothing is running right now."
              : "Nothing like that in this window."}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => {
            // Rows that only say "sent" fold into one line per day: the rows
            // that say something were lost between 64 of them (2026-10-01).
            const { rows, bare } = splitBareDispatches(group.events);
            return (
              <div key={group.day}>
                <h3 className="ui-activity-dayhead">{formatDayHeading(group.day)}</h3>
                <List aria-label={formatDayHeading(group.day)}>{rows.map(row)}</List>
                {bare.length > 0 && (
                  <details className="ui-activity-fold-row">
                    <summary>
                      <span className="ui-listrow-title">{bare.length} sent, no word back yet</span>
                      <span className="ui-activity-fold-row-who">
                        {projectTally(
                          bare.map((e) => ({ ...e, projectKey: titleOf(e.projectKey) })),
                        )}
                      </span>
                    </summary>
                    <List>{bare.map(row)}</List>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
