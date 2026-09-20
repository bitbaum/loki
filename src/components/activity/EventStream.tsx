import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import {
  filterActivityEvents,
  groupEventsByDay,
  tallyActivityEvents,
  type ActivityEvent,
  type ActivityFilter,
} from "@/lib/activity-events";
import type { DigestWindow } from "@/db/queries/digests";
import { ActivityEventRow } from "./ActivityEventRow";
import { activityHref, formatDayHeading } from "./activity-shared";

/**
 * The feed, triage-first.
 *
 * What changed and why: the old stream was an undifferentiated list with no way
 * to ask it a question. One red row sat among nineteen grey ones, the same
 * dispatch appeared twice, and the date was reprinted on every line. If you
 * opened this page because something broke, you had to find it by eye.
 *
 * Now the counts at the top ARE the filter — the number that provokes the
 * question is the control that answers it — and rows sit under day headings so
 * the timestamp column can shrink to a clock.
 */
export function EventStream({
  events,
  filter,
  digestWindow,
  projectKey,
}: {
  events: ActivityEvent[];
  filter: ActivityFilter;
  digestWindow: DigestWindow;
  projectKey: string | null;
}) {
  const tallies = tallyActivityEvents(events);
  const visible = filterActivityEvents(events, filter);
  const groups = groupEventsByDay(visible);

  const tabs: { id: ActivityFilter; label: string; count: number; tone?: string }[] = [
    { id: "all", label: "All", count: tallies.total },
    { id: "attention", label: "Needs attention", count: tallies.attention, tone: "attention" },
    { id: "running", label: "Running", count: tallies.running },
    { id: "queued", label: "Queued", count: tallies.queued },
    { id: "done", label: "Done", count: tallies.done },
  ];

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-text-primary">
          {tallies.total} {tallies.total === 1 ? "action" : "actions"}
        </h2>
        <p className="text-xs text-text-tertiary">
          What you asked for, what came back, and what is next.
        </p>
      </div>

      {/* Counts that are also the filter. A count you cannot follow to its
          subject is decoration; these navigate. */}
      <div className="ui-activity-tabs" role="tablist" aria-label="Filter activity by outcome">
        {tabs.map((tab) => {
          const active = filter === tab.id;
          // A zero bucket is still worth showing for "all"; the others would
          // just be dead chips, so they step aside.
          if (tab.count === 0 && tab.id !== "all" && !active) return null;
          return (
            <Link
              key={tab.id}
              href={activityHref({ window: digestWindow, project: projectKey, filter: tab.id })}
              role="tab"
              aria-selected={active}
              className={cn(
                "ui-activity-tab",
                active && "ui-activity-tab-active",
                tab.tone === "attention" && tab.count > 0 && !active && "ui-activity-tab-alert",
              )}
            >
              {tab.label}
              <span className="ui-activity-tab-count tabular-nums">{tab.count}</span>
            </Link>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-text-muted">
          {filter === "attention"
            ? "Nothing needs your attention in this window."
            : filter === "running"
              ? "Nothing is running right now."
              : "No matching activity in this window."}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.day}>
              <h3 className="ui-activity-day">{formatDayHeading(group.day)}</h3>
              <ul className="ui-activity-list">
                {group.events.map((event) => (
                  <ActivityEventRow key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
