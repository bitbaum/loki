"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { FetchErrorState } from "@/components/ui/fetch-error-state";
import { useFetch } from "@/hooks/use-fetch";
import { REFRESH_CADENCE } from "@/config/refresh";
import { APP_LOCALE } from "@/lib/constants";

type CalendarEvent = {
  summary?: string;
  title?: string;
  start?: string;
  startTime?: string;
  location?: string;
};

export function CalendarCard() {
  const { data, loading, error, refetch } = useFetch<{
    events: CalendarEvent[];
    error?: string;
    runtimeOnly?: boolean;
  }>("/api/calendar", { intervalMs: REFRESH_CADENCE.calendar, timeoutMs: 12_000 });
  const events = data?.events ?? [];

  // Cloud mode: calendar data comes from the `gog` CLI on the machine running the
  // web server, which the hosted box can't reach and the runner can't supply.
  // Rather than show a permanent "open localhost" apology on hosted, hide the card
  // entirely — it only earns its place on a local install. Weather sits beside it.
  if (data?.runtimeOnly) return null;

  // Today's events, as rows: what, where, and the time on the right (design
  // reset, 2026-10). Loading draws nothing rather than a skeleton card.
  if (loading && !data) return null;

  return (
    <Section title="Calendar">
      {error || (data?.error && events.length === 0) ? (
        <FetchErrorState
          message="Couldn't load calendar"
          detail={error ?? data?.error}
          onRetry={refetch}
        />
      ) : events.length === 0 ? (
        <EmptyState>Nothing in the calendar today.</EmptyState>
      ) : (
        <List aria-label="Today's events">
          {events.map((event, i) => (
            <ListRow
              key={`${event.start ?? event.startTime ?? i}-${event.summary ?? event.title ?? i}`}
              title={event.summary ?? event.title ?? "Untitled"}
              secondary={event.location}
              trailing={formatTime(event.start ?? event.startTime)}
            />
          ))}
        </List>
      )}
    </Section>
  );
}

function formatTime(time: string | undefined): string {
  if (!time) return "";
  try {
    const d = new Date(time);
    if (isNaN(d.getTime())) return time.slice(0, 5);
    return d.toLocaleTimeString(APP_LOCALE, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
