"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Circle, CircleCheck, Search } from "lucide-react";
import { LOKI_IMPORT_PROJECT_HREF, LOKI_NEW_PROJECT_HREF } from "@/config/loki-suggested-actions";
import { LokiPaneBody } from "./LokiPaneBody";
import type { LokiProject } from "./types";
import { rankByQuery, type SearchSpec } from "@/lib/search";
import { projectTitle } from "@/lib/project-display";
import { List, ListRow } from "@/components/ui/list-row";

const PROJECT_NAME_SPEC: SearchSpec<LokiProject> = {
  fields: [
    { name: "title", get: (p) => projectTitle(p) },
    { name: "name", get: (p) => p.name },
  ],
};

/** The goal under a project's name, with its progress said in words. A bare
 *  "· 0%" at the end of every row explained nothing (owner audit, 2026-11-12). */
function goalLine(goal: LokiProject["topGoal"]): string | undefined {
  if (!goal) return undefined;
  const pct = goal.progress;
  return typeof pct === "number" && pct > 0 ? `${goal.title} · ${pct}% done` : goal.title;
}

export function ProjectFilter({
  projects,
  selected,
  loading,
  error,
  onRetry,
  onToggle,
  onSelectMany,
  onClear,
}: {
  projects: LokiProject[];
  selected: string[];
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  onToggle: (name: string) => void;
  /** Add every currently-filtered project to the selection in one click — the
   *  whole point of multi-dispatch (same task → N projects) without N clicks. */
  onSelectMany?: (names: string[]) => void;
  onClear?: () => void;
}) {
  const [query, setQuery] = useState("");
  // Best match first; one slip in a project's name still finds it.
  const filtered = useMemo(
    () => rankByQuery(projects, PROJECT_NAME_SPEC, query),
    [projects, query],
  );

  return (
    <div className="flex h-full flex-col gap-2">
      {/* The drawer's own heading names this list. "All" used to sit here,
          32px wide, choosing every one of ~50 projects for the next message;
          picking many is now offered only for what a search matched. */}
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Link href={LOKI_NEW_PROJECT_HREF} className="ui-btn-xs ui-tap">
          New project
        </Link>
        {onSelectMany && query && filtered.length > 1 && (
          <button
            type="button"
            className="ui-btn-xs ui-tap"
            onClick={() => onSelectMany(filtered.map((p) => p.name))}
          >
            Pick all {filtered.length} matches
          </button>
        )}
        {onClear && selected.length > 0 && (
          <button type="button" className="ui-btn-xs ui-tap" onClick={onClear}>
            Clear {selected.length === 1 ? "choice" : `${selected.length} choices`}
          </button>
        )}
      </div>

      {projects.length > 8 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter projects…"
            className="ui-input-compact w-full pl-7"
            aria-label="Filter projects"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <LokiPaneBody loading={loading} error={error} onRetry={onRetry}>
          {projects.length === 0 ? (
            <div className="flex flex-col gap-3 px-1">
              <p className="ui-loki-convo-meta">
                No projects yet. Start one, or import one you already have.
              </p>
              <Link href={LOKI_NEW_PROJECT_HREF} className="ui-btn-primary justify-center">
                New project
              </Link>
              <Link href={LOKI_IMPORT_PROJECT_HREF} className="ui-btn-secondary justify-center">
                I have one
              </Link>
            </div>
          ) : filtered.length === 0 ? (
            <p className="ui-loki-convo-meta">No projects match “{query}”.</p>
          ) : (
            <List aria-label="Projects">
              {filtered.map((p) => {
                const isOn = selected.includes(p.name);
                const name = projectTitle(p);
                return (
                  <ListRow
                    key={p.id}
                    onClick={() => onToggle(p.name)}
                    icon={isOn ? CircleCheck : Circle}
                    className={isOn ? "ui-loki-project-active" : undefined}
                    title={name}
                    secondary={goalLine(p.topGoal)}
                    label={isOn ? `${name}, chosen` : name}
                  />
                );
              })}
            </List>
          )}
        </LokiPaneBody>
      </div>
    </div>
  );
}
