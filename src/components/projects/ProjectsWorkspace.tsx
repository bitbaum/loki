"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { FolderKanban, SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListSearch } from "@/components/ui/list-row";
import { ChoiceMenu } from "@/components/ui/choice-menu";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants/timings";
import { PROJECTS_LIST_CHUNK } from "@/lib/projects-display";
import {
  computeProjectsPageStats,
  filterProjects,
  hasProjectAttention,
  isProjectsSort,
  PROJECTS_SORTS,
  type ProjectsPageFilter,
  type ProjectsPageStats,
  type ProjectsSort,
} from "@/lib/projects-page-stats";
import { isArchivedProject, isEarlierCopy, type ProjectRunNow } from "@/lib/project-list-line";
import type { ProjectGridRow } from "./project-grid-row";
import { ProjectRow } from "./ProjectRow";

const FILTER_PARAMS = new Set<ProjectsPageFilter>(["attention", "next-step", "team"]);

function parseFilter(raw: string | null): ProjectsPageFilter {
  if (raw && FILTER_PARAMS.has(raw as ProjectsPageFilter)) return raw as ProjectsPageFilter;
  return null;
}

/** "Show: …" — each lens with its count, offered only when it holds something. */
const SHOW: {
  id: ProjectsPageFilter;
  label: string;
  count: (s: ProjectsPageStats) => number;
}[] = [
  { id: null, label: "All", count: (s) => s.total },
  { id: "attention", label: "With a problem", count: (s) => s.attention },
  { id: "next-step", label: "With a next step", count: (s) => s.withNextStep },
  { id: "team", label: "Shared with you", count: (s) => s.team },
];
const ALL = "all";

/** A search is a row worth having once the list is longer than a screen. */
const SEARCH_FROM = 8;

/**
 * The list of projects — a search, two menus that fit on one line, and rows
 * (design reset rules 3, 6 and 7). Nothing here sticks: the search is the
 * list's first row and scrolls away with it. Superseded copies and archived
 * projects fold under "Archived" at the end, kept and still openable.
 */
export function ProjectsWorkspace({
  projects,
  lastDispatchByProject = {},
  newNotesByProject = {},
  runNowByProject = {},
  emptyAction,
}: {
  projects: ProjectGridRow[];
  /** entity id → ISO timestamp of the newest agent run. */
  lastDispatchByProject?: Record<string, string>;
  /** entity id → notes from the site nobody has looked at yet. */
  newNotesByProject?: Record<string, number>;
  /** entity id → what is running there now (absent = nothing). */
  runNowByProject?: Record<string, ProjectRunNow>;
  /** The button an empty list offers — the same choice as the page's `+`. */
  emptyAction?: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [pageFilter, setPageFilter] = useState<ProjectsPageFilter>(() =>
    parseFilter(searchParams.get("filter")),
  );
  const [sort, setSort] = useState<ProjectsSort>(() => {
    const raw = searchParams.get("sort");
    return isProjectsSort(raw) ? raw : "priority";
  });
  const [listExpanded, setListExpanded] = useState(false);
  // One clock for every row's "2h", read once per render of the list.
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    if (pageFilter) params.set("filter", pageFilter);
    // Only when it differs from the default, so the common URL stays clean and
    // a shared link carries the order the sender was actually looking at.
    if (sort !== "priority") params.set("sort", sort);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [debouncedQuery, pageFilter, sort, pathname]);

  const [current, archived] = useMemo(() => {
    const keep: ProjectGridRow[] = [];
    const fold: ProjectGridRow[] = [];
    for (const p of projects) (isArchivedProject(p) ? fold : keep).push(p);
    return [keep, fold];
  }, [projects]);

  const stats = useMemo(() => computeProjectsPageStats(current), [current]);
  const lenses = SHOW.filter((l) => l.id === null || l.count(stats) > 0);

  const filtered = useMemo(
    () => filterProjects(current, debouncedQuery, pageFilter, lastDispatchByProject, sort),
    [current, debouncedQuery, pageFilter, lastDispatchByProject, sort],
  );
  const archivedShown = useMemo(
    () => (pageFilter ? [] : filterProjects(archived, debouncedQuery, null, undefined, "az")),
    [archived, debouncedQuery, pageFilter],
  );

  // Never fold a flagged project below the chunk line — attention outranks
  // the fold. (Sorting already puts them first, so this only matters when
  // there are more flagged rows than the chunk size.)
  const flaggedCount = useMemo(() => filtered.filter(hasProjectAttention).length, [filtered]);
  const chunk = Math.max(PROJECTS_LIST_CHUNK, flaggedCount);
  const listOverflow = filtered.length > chunk;
  const visible = listExpanded ? filtered : filtered.slice(0, chunk);

  const clear = () => {
    setQuery("");
    setPageFilter(null);
    setListExpanded(false);
  };

  if (projects.length === 0) {
    return <EmptyState icon={FolderKanban} title="No projects yet" action={emptyAction} />;
  }

  const row = (p: ProjectGridRow, secondary?: string) => (
    <ProjectRow
      key={p.id}
      project={p}
      lastDispatchAt={lastDispatchByProject[p.id] ?? null}
      newNotes={newNotesByProject[p.id] ?? 0}
      runNow={runNowByProject[p.id] ?? null}
      nowMs={nowMs}
      secondary={secondary}
    />
  );

  return (
    <div className="space-y-6">
      <section aria-label="Projects">
        {projects.length >= SEARCH_FROM && (
          <ListSearch
            value={query}
            onChange={(v) => {
              setQuery(v);
              setListExpanded(false);
            }}
            placeholder="Search projects"
          />
        )}

        {/* Fit or menu (rule 7): two one-button menus on one line, never a
            row of chips cut at the screen's edge. */}
        <div className="ui-projects-menus">
          {lenses.length > 1 ? (
            <ChoiceMenu
              label="Show"
              align="start"
              value={pageFilter ?? ALL}
              options={lenses.map((l) => ({
                value: l.id ?? ALL,
                label: `${l.label} (${l.count(stats)})`,
              }))}
              onChange={(v) => {
                setPageFilter(v === ALL ? null : parseFilter(v));
                setListExpanded(false);
              }}
            />
          ) : (
            <span className="ui-projects-count">
              {current.length} {current.length === 1 ? "project" : "projects"}
            </span>
          )}
          <ChoiceMenu
            label="Sort"
            value={sort}
            options={PROJECTS_SORTS.map(({ id, label, hint }) => ({
              value: id,
              label,
              hint,
            }))}
            onChange={(id) => {
              if (!isProjectsSort(id)) return;
              setSort(id);
              setListExpanded(false);
            }}
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={debouncedQuery ? `Nothing matches “${debouncedQuery}”` : "No projects here"}
            action={
              <button type="button" onClick={clear} className="ui-btn-secondary min-h-11">
                Show all projects
              </button>
            }
          />
        ) : (
          <List aria-label="Projects">{visible.map((p) => row(p))}</List>
        )}
        {listOverflow && !listExpanded && (
          <button
            type="button"
            onClick={() => setListExpanded(true)}
            className="ui-projects-show-more"
          >
            Show all {filtered.length}
          </button>
        )}
      </section>

      {archivedShown.length > 0 && (
        <details className="ui-projects-archived" open={Boolean(debouncedQuery.trim())}>
          <summary className="ui-projects-archived-summary">
            <span className="ui-section-heading">Archived</span>
            <span className="ui-listrow-trail">{archivedShown.length}</span>
          </summary>
          <List aria-label="Archived projects">
            {archivedShown.map((p) =>
              row(p, isEarlierCopy(p.name) ? "An earlier copy" : "Archived"),
            )}
          </List>
        </details>
      )}
    </div>
  );
}
