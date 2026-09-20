"use client";

import { useState } from "react";
import { Search, Calendar, Archive, ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EventCard } from "./EventCard";
import { AddEventForm } from "./AddEventForm";
import type { EventRow } from "@/db/queries/events";
import { EVENT_STATUS } from "@/lib/constants/statuses";
import { useEscapeKey } from "@/hooks/use-escape-key";

export function EventsGrid({
  initialEvents,
  initialArchived = [],
}: {
  initialEvents: EventRow[];
  initialArchived?: EventRow[];
}) {
  const [items, setItems] = useState(initialEvents);
  const [archived, setArchived] = useState(initialArchived);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  useEscapeKey(() => {
    setQuery("");
    setTypeFilter(null);
  });

  const types = [...new Set(items.map((e) => e.type).filter(Boolean))].sort() as string[];

  const q = query.trim().toLowerCase();
  const filtered = items.filter((e) => {
    const matchesQuery =
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q) ||
      e.category?.toLowerCase().includes(q);
    const matchesType = !typeFilter || e.type === typeFilter;
    return matchesQuery && matchesType;
  });

  const withDeadline = filtered.filter((e) => e.deadline);
  const withoutDeadline = filtered.filter((e) => !e.deadline);

  const handleDelete = (id: string) => setItems((prev) => prev.filter((e) => e.id !== id));
  const handleDeleteArchived = (id: string) =>
    setArchived((prev) => prev.filter((e) => e.id !== id));

  const handleArchive = (id: string) => {
    const event = items.find((e) => e.id === id);
    setItems((prev) => prev.filter((e) => e.id !== id));
    if (event) setArchived((prev) => [{ ...event, status: EVENT_STATUS.ARCHIVED }, ...prev]);
  };

  const handleEdit = (updated: EventRow) =>
    setItems((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));

  const handleCreated = (event: EventRow) => {
    setItems((prev) => (event.deadline ? [event, ...prev] : [...prev, event]));
  };

  return (
    <>
      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search events…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="ui-input pl-10 pr-14"
          />
          <span className="ui-badge absolute right-3 top-1/2 -translate-y-1/2">
            {q || typeFilter ? `${filtered.length} / ${items.length}` : items.length}
          </span>
        </div>
      </div>

      {/* Type filter chips */}
      {types.length > 1 && (
        <div className="ui-filter-chip-row ui-scroll-fade-right">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              className={`shrink-0 ${typeFilter === t ? "ui-chip-filter-active" : "ui-chip-filter"}`}
            >
              {t}
            </button>
          ))}
          {typeFilter && (
            <button onClick={() => setTypeFilter(null)} className="shrink-0 ui-chip-filter">
              Clear
            </button>
          )}
        </div>
      )}

      {/* Active events */}
      <Card>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <Calendar className="h-8 w-8 text-text-tertiary" />
            <div className="text-sm text-text-secondary">
              {q || typeFilter ? "No events match your filter" : "No events recorded yet"}
            </div>
          </div>
        ) : (
          <div>
            {withDeadline.length > 0 && (
              <div>
                {withDeadline.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onDelete={handleDelete}
                    onArchive={handleArchive}
                    onEdit={handleEdit}
                  />
                ))}
              </div>
            )}
            {withoutDeadline.length > 0 && (
              <div
                className={withDeadline.length > 0 ? "mt-2 pt-2 border-t border-border-subtle" : ""}
              >
                {withDeadline.length > 0 && <div className="ui-micro-label mb-2">No deadline</div>}
                {withoutDeadline.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onDelete={handleDelete}
                    onArchive={handleArchive}
                    onEdit={handleEdit}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <AddEventForm onCreated={handleCreated} existingTypes={types} />
      </Card>

      {/* Archived events — collapsible */}
      {archived.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center gap-1.5 ui-link-muted"
          >
            {showArchived ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <Archive className="h-3 w-3" />
            {archived.length} archived
          </button>
          {showArchived && (
            <Card className="mt-2">
              {archived.map((event) => (
                <EventCard key={event.id} event={event} onDelete={handleDeleteArchived} dimmed />
              ))}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
