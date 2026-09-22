"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Search, FolderKanban, ChevronDown } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants/timings";
import { PROJECTS_LIST_CHUNK } from "@/lib/projects-display";
import {
  computeProjectsPageStats,
  filterProjects,
  hasProjectAttention,
  type ProjectsPageFilter,
} from "@/lib/projects-page-stats";
import type { ProjectGridRow } from "./project-grid-row";
import { ProjectRow } from "./ProjectRow";
import { ProjectsSummary } from "./ProjectsSummary";
import { ProjectsCiPanel } from "./ProjectsCiPanel";

const FILTER_PARAMS = new Set<ProjectsPageFilter>(["attention", "next-step", "team"]);

function parseFilter(raw: string | null): ProjectsPageFilter {
  if (raw && FILTER_PARAMS.has(raw as ProjectsPageFilter)) return raw as ProjectsPageFilter;
  return null;
}

/**
 * One list, one row shape. Flagged projects sort first and carry their red
 * badges + warning edge — same grammar as every other row, not a different
 * component. The chunk fold keeps 30+ fleets scannable; search and the filter
 * chips work over everything.
 */
export function ProjectsWorkspace({
  projects,
  lastDispatchByProject = {},
  feedbackOpenByProject = {},
}: {
  projects: ProjectGridRow[];
  /** entity id → ISO timestamp of the newest real dispatch. */
  lastDispatchByProject?: Record<string, string>;
  /** entity id → open (new + dispatched) feedback count. */
  feedbackOpenByProject?: Record<string, number>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [pageFilter, setPageFilter] = useState<ProjectsPageFilter>(() =>
    parseFilter(searchParams.get("filter")),
  );
  const [listExpanded, setListExpanded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    if (pageFilter) params.set("filter", pageFilter);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [debouncedQuery, pageFilter, pathname]);

  const stats = useMemo(() => computeProjectsPageStats(projects), [projects]);

  const filtered = useMemo(
    () => filterProjects(projects, debouncedQuery, pageFilter, lastDispatchByProject),
    [projects, debouncedQuery, pageFilter, lastDispatchByProject],
  );

  // Never fold a flagged project below the chunk line — attention outranks
  // the fold. (Sorting already puts them first, so this only matters when
  // there are more flagged rows than the chunk size.)
  const flaggedCount = useMemo(() => filtered.filter(hasProjectAttention).length, [filtered]);
  const chunk = Math.max(PROJECTS_LIST_CHUNK, flaggedCount);
  const listOverflow = filtered.length > chunk;
  const visible = listExpanded ? filtered : filtered.slice(0, chunk);

  useEscapeKey(() => {
    setQuery("");
    setPageFilter(null);
  });

  const hasAnyProjects = projects.length > 0;

  return (
    <div className="space-y-5">
      <div className="ui-projects-sticky-bar space-y-3">
        <div className="relative min-w-0">
          <Search
            className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setListExpanded(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="ui-search-input"
            aria-label="Search projects"
          />
        </div>

        <ProjectsSummary
          stats={stats}
          activeFilter={pageFilter}
          onFilter={(next) => {
            setPageFilter(next);
            setListExpanded(false);
          }}
          resultCount={filtered.length}
          totalCount={projects.length}
        />
      </div>

      {filtered.length === 0 ? (
        hasAnyProjects ? (
          <EmptyState icon={FolderKanban} title="No projects match">
            {debouncedQuery
              ? `Nothing matched “${debouncedQuery}”. Try a shorter term or clear filters.`
              : "Clear filters to see your full fleet."}
          </EmptyState>
        ) : (
          <EmptyState icon={FolderKanban} title="No projects yet">
            Register your first project with “Add” above — connect a repo and the fleet can start
            working on it.
          </EmptyState>
        )
      ) : (
        <section aria-label="Projects">
          <div className="ui-projects-list flex flex-col">
            {visible.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                lastDispatchAt={lastDispatchByProject[project.id] ?? null}
                feedbackOpen={feedbackOpenByProject[project.id] ?? 0}
              />
            ))}
          </div>
          {listOverflow && !listExpanded && (
            <button
              type="button"
              onClick={() => setListExpanded(true)}
              className="ui-projects-show-more mt-2"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
              Show all {filtered.length} projects
            </button>
          )}
        </section>
      )}

      <ProjectsCiPanel projects={projects} />
    </div>
  );
}
