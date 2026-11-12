import type { ActivityEvent } from "@/lib/activity-events";
import { Section } from "@/components/ui/section-heading";
import { List, ListRow } from "@/components/ui/list-row";
import { titleFor, type ProjectNames } from "./activity-shared";
import { plainLine, watchHref } from "./activity-words";

/** "4 min" / "1h 5m" — minutes only: a seconds count reads as jitter. */
export function runningFor(sinceIso: string, now: Date): string {
  const minutes = Math.max(1, Math.round((now.getTime() - Date.parse(sinceIso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * What is running right now, first, with a live dot and how long it has
 * been at it; each row opens the run on Watch. Asked for on 2026-11-12: "I
 * would like to know if anything is actively running, and I would like to
 * watch it". Running was a choice halfway down the page, grey, mixed in with
 * failures — and claimed 23 runs on a builder that runs 8. A run that has gone
 * quiet is not here: it reads "Stopped answering" (lib/activity-events).
 *
 * Renders nothing when nothing runs.
 */
export function RunningNowCard({
  events,
  names,
  now,
}: {
  events: ActivityEvent[];
  names: ProjectNames;
  now: Date;
}) {
  const running = events.filter((e) => e.outcome === "running");
  if (running.length === 0) return null;
  return (
    <Section title="Running now">
      <List aria-label="Running now">
        {running.map((event) => {
          const what = plainLine(event.ask?.preview ?? "") || event.intentLabel;
          return (
            <ListRow
              key={event.id}
              href={watchHref(event, names)}
              status="positive"
              title={titleFor(names, event.projectKey)}
              secondary={`Working for ${runningFor(event.occurredAt, now)} · ${what}`}
              chevron
            />
          );
        })}
      </List>
    </Section>
  );
}
