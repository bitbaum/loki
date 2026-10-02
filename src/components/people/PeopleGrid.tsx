"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, ArrowUpDown, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { PersonCard } from "./PersonCard";
import { NewPersonButton } from "./NewPersonButton";
import { PeopleBookPanel } from "./PeopleBookPanel";
import { type PersonWithAttributes } from "@/db/queries/people";
import { getJson } from "@/lib/api/fetch";
import { SORT_MODE, SORT_LABELS, type SortMode } from "@/lib/constants/statuses";
import {
  type RelationshipHealth,
  HEALTH_DOT_COLOR,
  HEALTH_LABEL,
  RELATIONSHIP_HEALTH_VALUES,
  deriveRelationshipHealth,
} from "@/lib/constants/people";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants/timings";

const HEALTH_FILTERS = RELATIONSHIP_HEALTH_VALUES.map((value) => ({
  value,
  label: HEALTH_LABEL[value],
}));

const SORT_ORDER: SortMode[] = Object.values(SORT_MODE);

export function PeopleGrid({
  initialPeople,
  initialTotal,
  initialHealthFilter = [],
}: {
  initialPeople: PersonWithAttributes[];
  initialTotal: number;
  initialHealthFilter?: RelationshipHealth[];
}) {
  const [people, setPeople] = useState(initialPeople);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>(SORT_MODE.RECENT);
  const [healthFilter, setHealthFilter] = useState<RelationshipHealth[]>(initialHealthFilter);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;
  const skipInitialFetch = useRef(true);

  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get("open");
    if (open) router.replace(`/people/${open}`);
  }, [router]);

  // Keep URL bar in sync with health filter so the link is bookmarkable/shareable.
  // Uses replaceState (not router.replace) to avoid triggering a server re-render.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (healthFilter.length > 0) {
      params.set("health", healthFilter.join(","));
    } else {
      params.delete("health");
    }
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [healthFilter]);

  const search = useCallback(
    async (
      q: string,
      s: SortMode,
      hf: RelationshipHealth[],
      newOffset: number,
      signal?: AbortSignal,
    ) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q,
          sort: s,
          limit: String(LIMIT),
          offset: String(newOffset),
        });
        if (hf.length > 0) params.set("health", hf.join(","));
        const data = await getJson<{ people: PersonWithAttributes[]; total: number }>(
          `/api/people?${params}`,
          { signal },
        );
        if (signal?.aborted) return;
        setFetchError(false);
        if (newOffset === 0) {
          setPeople(data.people);
        } else {
          setPeople((prev) => [...prev, ...data.people]);
        }
        setTotal(data.total);
        setOffset(newOffset);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setFetchError(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => search(query, sort, healthFilter, 0, ctrl.signal),
      SEARCH_DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, sort, healthFilter, search]);

  useEscapeKey(() => {
    setQuery("");
    setHealthFilter([]);
  });

  function toggleHealth(h: RelationshipHealth) {
    setHealthFilter((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]));
  }

  function cycleSort() {
    const idx = SORT_ORDER.indexOf(sort);
    setSort(SORT_ORDER[(idx + 1) % SORT_ORDER.length]);
  }

  function handleLogged(id: string, at: Date) {
    const newHealth = deriveRelationshipHealth(at);
    const removedByFilter = healthFilter.length > 0 && !healthFilter.includes(newHealth);
    setPeople((prev) =>
      removedByFilter
        ? prev.filter((p) => p.id !== id)
        : prev.map((p) =>
            p.id === id
              ? {
                  ...p,
                  lastInteraction: at,
                  interactionCount: p.interactionCount + 1,
                  health: newHealth,
                }
              : p,
          ),
    );
    if (removedByFilter) setTotal((t) => t - 1);
  }

  return (
    <>
      {/* One row on a phone, not three. Stacked full-width, a search box, a
          sort toggle and Add cost 164px — a fifth of the screen — on a page
          whose job is to show people. Sort keeps its label from `sm` up and
          drops to its icon below, where the word "Recent" is not worth 100px. */}
      <div className="flex items-center gap-2 sm:flex-wrap sm:gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="Search people..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="ui-search-input"
          />
          <span className="ui-badge absolute right-3 top-1/2 -translate-y-1/2">{total}</span>
        </div>
        <button
          onClick={cycleSort}
          className="ui-btn-chip shrink-0 rounded-2xl px-3 py-3 sm:px-4"
          title={`Sort: ${SORT_LABELS[sort]}`}
          aria-label={`Sort: ${SORT_LABELS[sort]}`}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Sort: {SORT_LABELS[sort]}</span>
        </button>
        <NewPersonButton onCreated={() => search(query, sort, healthFilter, 0)} />
      </div>

      {/* One scrolling row rather than a wrapping block: four health chips plus
          Clear wrapped to two rows and took 96px above the first contact. */}
      <div className="ui-filter-chip-row ui-scroll-fade-right -mx-4 gap-2 px-4 pb-1 sm:mx-0 sm:px-0">
        {HEALTH_FILTERS.map(({ value, label }) => {
          const active = healthFilter.includes(value);
          return (
            <button
              key={value}
              onClick={() => toggleHealth(value)}
              className={`inline-flex shrink-0 items-center gap-2 ${active ? "ui-chip-toggle-active" : "ui-chip-toggle"}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT_COLOR[value]}`} />
              {label}
            </button>
          );
        })}
        {healthFilter.length > 0 && (
          <button onClick={() => setHealthFilter([])} className="ui-chip-filter shrink-0">
            Clear
          </button>
        )}
      </div>

      {fetchError && (
        <div className="ui-callout-negative items-center justify-between text-status-negative">
          <span>Failed to load — check your connection and try again.</span>
          <button
            onClick={() => search(query, sort, healthFilter, 0)}
            className="ml-4 shrink-0 font-medium underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            Retry
          </button>
        </div>
      )}
      {people.length === 0 && !fetchError ? (
        <div className="ui-empty-panel">
          <Users className="h-8 w-8" />
          <div className="text-base text-text-secondary">
            {query || healthFilter.length > 0 ? "No people match your search" : "No people yet"}
          </div>
          {(query || healthFilter.length > 0) && (
            <button
              onClick={() => {
                setQuery("");
                setHealthFilter([]);
              }}
              className="text-sm text-accent-text underline underline-offset-2 transition-colors hover:text-accent-hover"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {people.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              onClick={() => router.push(`/people/${person.id}`)}
              onLogged={handleLogged}
            />
          ))}
        </div>
      )}

      {people.length < total && (
        <button
          onClick={() => search(query, sort, healthFilter, offset + LIMIT)}
          disabled={loading}
          className="ui-btn-chip w-full rounded-2xl px-4 py-3"
        >
          {loading ? "Loading..." : `Load more (${people.length} of ${total})`}
        </button>
      )}

      {/* Below the list on purpose. Import, sync and enrich are setup you do
          once; the people are what you opened the page for. It used to sit
          above the list and cost 482px there — more than half a phone screen
          of glossary and export recipes before the first contact. Expanded by
          default only when the book is empty, which is the one time it IS the
          page. */}
      <PeopleBookPanel
        defaultOpen={total === 0}
        onChanged={() => search(query, sort, healthFilter, 0)}
      />
    </>
  );
}
