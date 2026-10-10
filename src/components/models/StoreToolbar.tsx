"use client";

import { Search, X } from "lucide-react";
import type { StoreLab } from "@/lib/models/store-catalog";
import {
  DEFAULT_FILTERS,
  PRICE_CEILINGS,
  STORE_SORTS,
  serializeFilters,
  type StoreFilters,
  type StoreSort,
} from "@/lib/models/store-filters";

/**
 * The controls over the table: a search box, five yes/no chips, a lab, a
 * price ceiling and a sort. Each control is one filter field, and the whole
 * state is the URL (lib/models/store-filters.ts), so "open-weight models
 * under $1 from Qwen, smartest first" is a link.
 */
const CHIPS: ReadonlyArray<{
  key: "open" | "free" | "vision" | "reasoning" | "mine";
  label: string;
  title: string;
}> = [
  { key: "open", label: "Open weights", title: "Weights published — can run on your own machine" },
  { key: "free", label: "Free to try", title: "Free, or has a free variant on OpenRouter" },
  { key: "vision", label: "Sees images", title: "Takes an image as input" },
  { key: "reasoning", label: "Reasoning", title: "Thinks before answering" },
  { key: "mine", label: "On your keys", title: "Reachable on a key you hold" },
];

export function StoreToolbar({
  filters,
  labs,
  hasKeys,
  onChange,
}: {
  filters: StoreFilters;
  labs: StoreLab[];
  hasKeys: boolean;
  onChange: (next: StoreFilters) => void;
}) {
  const set = <K extends keyof StoreFilters>(key: K, value: StoreFilters[K]) =>
    onChange({ ...filters, [key]: value });
  const active = serializeFilters({ ...filters, sort: DEFAULT_FILTERS.sort }).length > 0;

  return (
    <div className="ui-store-toolbar">
      <label className="relative block min-w-0 flex-1 basis-56">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          className="ui-input w-full pl-9"
          placeholder="Search a model or a lab"
          value={filters.q}
          onChange={(e) => set("q", e.target.value)}
          aria-label="Search models"
        />
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
        {CHIPS.filter((c) => c.key !== "mine" || hasKeys).map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={filters[c.key]}
            title={c.title}
            className={filters[c.key] ? "ui-chip-toggle-active" : "ui-chip-toggle"}
            onClick={() => set(c.key, !filters[c.key])}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          className="ui-input ui-input-compact"
          value={filters.lab ?? ""}
          onChange={(e) => set("lab", e.target.value || null)}
          aria-label="Lab"
        >
          <option value="">All labs</option>
          {labs.map((lab) => (
            <option key={lab.id} value={lab.id}>
              {lab.label} · {lab.count}
            </option>
          ))}
        </select>
        <select
          className="ui-input ui-input-compact"
          value={filters.max ?? ""}
          onChange={(e) => set("max", e.target.value ? Number(e.target.value) : null)}
          aria-label="Price ceiling"
        >
          <option value="">Any price</option>
          {PRICE_CEILINGS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className="ui-input ui-input-compact"
          value={filters.sort}
          onChange={(e) => set("sort", e.target.value as StoreSort)}
          aria-label="Sort"
        >
          {STORE_SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {active && (
          <button
            type="button"
            className="ui-btn-ghost text-xs"
            onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
