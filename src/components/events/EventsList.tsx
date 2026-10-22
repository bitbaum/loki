"use client";

import { useState } from "react";
import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import { CalendarClock, CalendarDays, Search } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { List, ListRow, ListSearch } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { ChoiceMenu } from "@/components/ui/choice-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { filterByQuery, type SearchSpec } from "@/lib/search";
import type { EventRow } from "@/db/queries/events";
import { EventSheet } from "./EventSheet";
import { NewEventButton } from "./NewEventButton";

const EVENT_SEARCH_SPEC: SearchSpec<EventRow> = {
  fields: [
    { name: "name", get: (e) => e.name },
    { name: "category", get: (e) => e.category },
    { name: "description", get: (e) => e.description },
  ],
};

const ALL = "__all";

/**
 * When an event happens, for this list: its deadline when it has one (a grant,
 * a call for papers), else the day it takes place. The list used to read only
 * the deadline, so a meetup with a date and a place sat under "No deadline"
 * as if it had neither.
 */
export function eventWhen(e: EventRow): Date | null {
  const d = e.deadline ?? e.dateStart;
  return d ? new Date(d) : null;
}

const byWhen = (a: EventRow, b: EventRow) => {
  const wa = eventWhen(a);
  const wb = eventWhen(b);
  if (!wa) return 1;
  if (!wb) return -1;
  return wa.getTime() - wb.getTime();
};

/** "in 6 days", "3 days ago", "today" — said plainly. */
function relative(when: Date): string {
  const days = differenceInCalendarDays(when, new Date());
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

/**
 * /events — opportunities and deadlines as rows: the soonest first, each with
 * its kind and how long is left, the date on the right. A row opens the event
 * in a sheet. Renders its own PageLayout because the page action ("New event")
 * adds to this list's state.
 */
export function EventsList({
  initialEvents,
  initialArchived,
}: {
  initialEvents: EventRow[];
  initialArchived: EventRow[];
}) {
  const [items, setItems] = useState(initialEvents);
  const [archived, setArchived] = useState(initialArchived);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string>(ALL);
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const kinds = [...new Set(items.map((e) => e.type).filter(Boolean))].sort();
  const q = query.trim();
  const filtered = filterByQuery(
    kind === ALL ? items : items.filter((e) => e.type === kind),
    EVENT_SEARCH_SPEC,
    q,
  );
  const today = startOfDay(new Date());
  const sorted = [...filtered].sort(byWhen);
  const ahead = sorted.filter((e) => {
    const w = eventWhen(e);
    return w && w >= today;
  });
  const past = sorted
    .filter((e) => {
      const w = eventWhen(e);
      return w && w < today;
    })
    .reverse();
  const undated = sorted.filter((e) => !eventWhen(e));
  const opened =
    items.find((e) => e.id === openId) ?? archived.find((e) => e.id === openId) ?? null;

  const next = [...items].sort(byWhen).find((e) => {
    const w = eventWhen(e);
    return w && w >= startOfDay(new Date());
  });
  const nextWhen = next ? eventWhen(next) : null;
  const summary =
    items.length === 0
      ? null
      : next && nextWhen
        ? `Next: ${next.name}, ${relative(nextWhen).toLowerCase()}.`
        : "Nothing ahead with a date.";

  const onCreated = (event: EventRow) => setItems((prev) => [...prev, event]);

  const rows = (list: EventRow[], dim = false) => (
    <List aria-label="Events">
      {list.map((e) => (
        <EventListRow key={e.id} event={e} dim={dim} onOpen={() => setOpenId(e.id)} />
      ))}
    </List>
  );

  return (
    <PageLayout
      title="Events"
      maxWidth="max-w-2xl"
      action={<NewEventButton onCreated={onCreated} existingTypes={kinds} />}
    >
      {items.length === 0 && archived.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="A conference, a grant, a deadline worth catching?"
          action={
            <NewEventButton
              onCreated={onCreated}
              existingTypes={kinds}
              trigger="secondary"
              triggerLabel="Add the first event"
            />
          }
        />
      ) : (
        <>
          {summary && <p className="ui-life-summary">{summary}</p>}
          {items.length > 6 && (
            <ListSearch value={query} onChange={setQuery} placeholder="Search events" />
          )}

          <Section
            title="Coming up"
            right={
              kinds.length > 1 ? (
                <ChoiceMenu
                  label="Show"
                  value={kind}
                  options={[
                    { value: ALL, label: "Every kind" },
                    ...kinds.map((k) => ({ value: k, label: k })),
                  ]}
                  onChange={setKind}
                />
              ) : undefined
            }
          >
            {ahead.length > 0 ? (
              rows(ahead)
            ) : q || kind !== ALL ? (
              <EmptyState
                icon={Search}
                size="sm"
                title="Nothing matches"
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setKind(ALL);
                    }}
                    className="ui-btn-secondary"
                  >
                    Show every event
                  </button>
                }
              />
            ) : (
              <EmptyState>Nothing ahead with a date.</EmptyState>
            )}
          </Section>

          {undated.length > 0 && <Section title="No date yet">{rows(undated)}</Section>}
          {past.length > 0 && <Section title="Already happened">{rows(past, true)}</Section>}

          {archived.length > 0 && (
            <Section
              title={`Archived · ${archived.length}`}
              right={
                <button
                  type="button"
                  onClick={() => setShowArchived((v) => !v)}
                  className="ui-section-link"
                  aria-expanded={showArchived}
                >
                  {showArchived ? "Hide" : "Show"}
                </button>
              }
            >
              {showArchived && rows(archived, true)}
            </Section>
          )}
        </>
      )}

      {opened && (
        <EventSheet
          key={opened.id}
          event={opened}
          archived={archived.some((e) => e.id === opened.id)}
          onClose={() => setOpenId(null)}
          onChanged={(u) => setItems((prev) => prev.map((e) => (e.id === u.id ? u : e)))}
          onArchived={(id) => {
            const ev = items.find((e) => e.id === id);
            setItems((prev) => prev.filter((e) => e.id !== id));
            if (ev) setArchived((prev) => [ev, ...prev]);
          }}
          onDeleted={(id) => {
            setItems((prev) => prev.filter((e) => e.id !== id));
            setArchived((prev) => prev.filter((e) => e.id !== id));
          }}
        />
      )}
    </PageLayout>
  );
}

function EventListRow({
  event,
  dim,
  onOpen,
}: {
  event: EventRow;
  dim: boolean;
  onOpen: () => void;
}) {
  const when = eventWhen(event);
  const kind = event.type ? event.type.charAt(0).toUpperCase() + event.type.slice(1) : "";
  const isDeadline = !!event.deadline;
  return (
    <ListRow
      onClick={onOpen}
      icon={isDeadline ? CalendarClock : CalendarDays}
      title={event.name}
      secondary={[
        kind,
        event.location,
        when && !dim ? `${isDeadline ? "Due " : ""}${relative(when).toLowerCase()}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      trailing={when ? format(when, "d MMM") : undefined}
      className={dim ? "opacity-60" : undefined}
      chevron
    />
  );
}
