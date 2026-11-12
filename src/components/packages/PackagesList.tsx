"use client";

import { useMemo, useState } from "react";
import { Package, Search } from "lucide-react";
import { Highlight } from "@bitbaum/searchkit/react";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow, ListSearch } from "@/components/ui/list-row";
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

/**
 * "20 of 22 projects behind · v1.7.1" — the row's one line, the fact worth
 * opening the row for first. It read "latest v1.7.1 · used by 22 projects,
 * 20 beh…" and the ellipsis took exactly that fact at 390px (2026-11-12).
 */
export function packageLine(row: PackageListRow): string {
  const version = versionText(row.latest.version);
  if (row.usedBy === 0) return `${version} · not in your projects`;
  const projects = row.usedBy === 1 ? "project" : "projects";
  const lead =
    row.behind > 0
      ? `${row.behind} of ${row.usedBy} ${projects} behind`
      : row.unknown > 0
        ? `${row.usedBy} ${projects}`
        : `${row.usedBy} ${projects}, all up to date`;
  const unknown = row.unknown > 0 ? ` · ${row.unknown} unknown` : "";
  return `${lead}${unknown} · ${version}`;
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
    <div>
      <ListSearch value={query} onChange={setQuery} placeholder="Search packages" />
      {matches.length === 0 ? (
        <EmptyState
          icon={Search}
          title={`No package matches “${query}”`}
          size="sm"
          action={
            <button type="button" className="ui-btn-secondary" onClick={() => setQuery("")}>
              Show every package
            </button>
          }
        />
      ) : (
        <List aria-label="Packages">
          {matches.map(({ row, nameRanges }) => (
            <ListRow
              key={row.slug}
              href={`/packages/${row.slug}`}
              icon={Package}
              title={
                nameRanges ? (
                  <Highlight text={row.name} ranges={nameRanges} markClassName="ui-search-mark" />
                ) : (
                  row.name
                )
              }
              secondary={packageLine(row)}
              chevron
            />
          ))}
        </List>
      )}
    </div>
  );
}
