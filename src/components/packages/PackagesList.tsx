"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Package, Search } from "lucide-react";
import { Highlight } from "@bitbaum/searchkit/react";
import { EmptyState } from "@/components/ui/empty-state";
import { searchHits, type Range, type SearchSpec } from "@/lib/search";
import type { PackageListRow } from "@/lib/packages/view";

const PACKAGE_SEARCH_SPEC: SearchSpec<PackageListRow> = {
  fields: [
    { name: "name", get: (row) => row.name },
    { name: "slug", get: (row) => row.slug },
    { name: "summary", get: (row) => row.summary ?? "" },
  ],
};

/** "v1.20.1", or a dash when nobody could say. */
function versionText(version: string | null): string {
  return version ? `v${version}` : "—";
}

function UsageTags({ row }: { row: PackageListRow }) {
  if (row.usedBy === 0) {
    return <span className="text-xs text-text-muted">Not in your projects</span>;
  }
  return (
    <>
      <span className="ui-badge">
        Used by {row.usedBy} {row.usedBy === 1 ? "project" : "projects"}
      </span>
      {row.onLatest > 0 && <span className="ui-tag ui-tag-positive">{row.onLatest} on latest</span>}
      {row.behind > 0 && <span className="ui-tag ui-tag-warning">{row.behind} behind</span>}
      {row.unknown > 0 && <span className="ui-tag ui-tag-neutral">{row.unknown} unknown</span>}
    </>
  );
}

/** Every fleet package, searchable; each row opens the package's own page. */
export function PackagesList({ rows }: { rows: PackageListRow[] }) {
  const [query, setQuery] = useState("");
  const matches = useMemo<{ row: PackageListRow; nameRanges?: readonly Range[] }[]>(() => {
    if (!query.trim()) return rows.map((row) => ({ row }));
    return searchHits(rows, PACKAGE_SEARCH_SPEC, query).map((hit) => ({
      row: hit.item,
      nameRanges: hit.matches.name,
    }));
  }, [rows, query]);

  return (
    <div className="space-y-4">
      <div className="relative min-w-0">
        <Search
          className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
          aria-hidden
        />
        <input
          type="search"
          placeholder="Search packages…"
          aria-label="Search packages"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          className="ui-search-input"
        />
        <span className="ui-badge absolute right-3 top-1/2 -translate-y-1/2">{matches.length}</span>
      </div>

      {matches.length === 0 ? (
        <EmptyState icon={Package} title={`No package matches “${query}”`} size="sm">
          <button type="button" className="ui-btn-ghost min-h-11" onClick={() => setQuery("")}>
            Show every package
          </button>
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {matches.map(({ row, nameRanges }) => (
            <li key={row.slug}>
              <Link
                href={`/packages/${row.slug}`}
                className="ui-list-row ui-row-interactive flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="wrap-anywhere font-medium text-text-primary">
                      {nameRanges ? (
                        <Highlight
                          text={row.name}
                          ranges={nameRanges}
                          markClassName="ui-search-mark"
                        />
                      ) : (
                        row.name
                      )}
                    </span>
                    <span className="font-mono text-xs text-text-tertiary">
                      latest {versionText(row.latest.version)}
                    </span>
                  </span>
                  {row.summary && (
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-text-tertiary">
                      {row.summary}
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                  <UsageTags row={row} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
