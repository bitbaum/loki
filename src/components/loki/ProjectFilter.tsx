"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Search } from "lucide-react";
import { LOKI_IMPORT_PROJECT_HREF, LOKI_NEW_PROJECT_HREF } from "@/config/loki-suggested-actions";
import { LokiPaneBody } from "./LokiPaneBody";
import type { LokiProject } from "./types";
import { rankByQuery, type SearchSpec } from "@/lib/search";

const PROJECT_NAME_SPEC: SearchSpec<LokiProject> = {
  fields: [{ name: "name", get: (p) => p.name }],
};

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
      <div className="flex items-center justify-between gap-2">
        <h2 className="ui-kicker">Projects{selected.length > 0 ? ` · ${selected.length}` : ""}</h2>
        <div className="flex items-center gap-1">
          <Link href={LOKI_NEW_PROJECT_HREF} className="ui-btn-xs">
            New
          </Link>
          {onSelectMany && filtered.length > 0 && (
            <button
              type="button"
              className="ui-btn-xs"
              onClick={() => onSelectMany(filtered.map((p) => p.name))}
              title={query ? "Select all matching" : "Select all projects"}
            >
              All{query ? ` (${filtered.length})` : ""}
            </button>
          )}
          {onClear && selected.length > 0 && (
            <button type="button" className="ui-btn-xs" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
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
            <div className="flex flex-col gap-1">
              {filtered.map((p) => {
                const isOn = selected.includes(p.name);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onToggle(p.name)}
                    className={`ui-loki-project ${isOn ? "ui-loki-project-active" : ""}`}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {isOn && <Check className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.name}</span>
                      {p.topGoal && (
                        <span className="ui-loki-project-goal" title={p.topGoal.title}>
                          {p.topGoal.title}
                          {typeof p.topGoal.progress === "number"
                            ? ` · ${p.topGoal.progress}%`
                            : ""}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </LokiPaneBody>
      </div>
    </div>
  );
}
