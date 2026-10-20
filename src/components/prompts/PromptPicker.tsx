"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Highlight } from "@bitbaum/searchkit/react";
import {
  CATEGORY_META,
  GROUP_META,
  PROMPT_GROUPS,
  PROMPT_TEMPLATES,
  groupForCategory,
  substituteProjectName,
  type PromptGroup,
  type PromptTemplate,
} from "@/config/prompt-library";
import { ScrollAffordance } from "@/components/ui/scroll-affordance";
import { cn } from "@/lib/utils";
import { collapseDuplicates } from "@/lib/prompt-duplicates";
import {
  PROMPT_ENTRY_SEARCH_SPEC,
  savedPromptAsTemplate,
  searchPrompts,
  type PromptEntry,
  type SavedPrompt,
} from "@/lib/prompt-search";
import { type Range } from "@/lib/search";

const PICKER_LIMIT = 40;

type Filter = "all" | "yours" | PromptGroup;

/** Your saved prompts, read at most once a minute — the picker opens often,
 *  and a prompt saved a minute ago on /prompts should still turn up. */
const SAVED_TTL_MS = 60_000;
let savedCache: { at: number; rows: Promise<SavedPrompt[]> } | null = null;
function loadSaved(): Promise<SavedPrompt[]> {
  if (savedCache && Date.now() - savedCache.at < SAVED_TTL_MS) return savedCache.rows;
  const rows = fetch("/api/prompts")
    .then((r) => (r.ok ? r.json() : { prompts: [] }))
    .then((d: { prompts?: SavedPrompt[] }) => collapseDuplicates(d.prompts ?? []).visible)
    .catch(() => {
      savedCache = null;
      return [] as SavedPrompt[];
    });
  savedCache = { at: Date.now(), rows };
  return rows;
}

/**
 * The prompt library as a *picker*, in every box where words are written for
 * an agent. It lists YOUR prompts first, then Loki's library, and one search
 * finds either by name, tag, category, description or the words inside them.
 *
 * Until 2026-10-15 it listed only Loki's 44 built-in prompts: the ones a
 * person had saved on /prompts were not in it at all (operator: "picking the
 * right prompt from the prompt library is great, but it's not that easy to
 * find them"). The chips narrow to Yours or a group without typing.
 */
export function PromptPicker({
  projectName,
  onPick,
  onClose,
  /** Show only prompts that make sense against a single project. */
  projectScopedOnly = false,
  className,
}: {
  projectName: string;
  onPick: (resolved: string, template: PromptTemplate) => void;
  onClose: () => void;
  projectScopedOnly?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [cursor, setCursor] = useState(0);
  const [saved, setSaved] = useState<SavedPrompt[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const [finePointer] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches,
  );

  useEffect(() => {
    let live = true;
    void loadSaved().then((rows) => {
      if (live) setSaved(rows);
    });
    return () => {
      live = false;
    };
  }, []);

  const entries = useMemo<PromptEntry[]>(() => {
    const own = saved.map((p) => ({
      template: savedPromptAsTemplate(p),
      own: true,
      uses: p.runCount,
    }));
    const library = (
      projectScopedOnly ? PROMPT_TEMPLATES.filter((t) => t.scope === "project") : PROMPT_TEMPLATES
    ).map((template) => ({ template, own: false, uses: 0 }));
    return [...own, ...library];
  }, [saved, projectScopedOnly]);

  const groups = useMemo(
    () =>
      PROMPT_GROUPS.filter((g) =>
        entries.some((e) => !e.own && groupForCategory(e.template.category) === g),
      ),
    [entries],
  );

  const matches = useMemo<{ entry: PromptEntry; nameRanges?: readonly Range[] }[]>(() => {
    const pool = entries.filter((e) =>
      filter === "all"
        ? true
        : filter === "yours"
          ? e.own
          : !e.own && groupForCategory(e.template.category) === filter,
    );
    if (!query.trim()) {
      // Browsing: yours first (as saved), then Loki's featured prompts.
      return [...pool]
        .sort(
          (a, b) =>
            Number(b.own) - Number(a.own) ||
            Number(!!b.template.featured) - Number(!!a.template.featured),
        )
        .slice(0, PICKER_LIMIT)
        .map((entry) => ({ entry }));
    }
    // Best match first, and a slip in a word still finds it ("secuirty").
    return searchPrompts(pool, PROMPT_ENTRY_SEARCH_SPEC, (e) => e.template.template, query)
      .slice(0, PICKER_LIMIT)
      .map((hit) => ({ entry: hit.item, nameRanges: hit.matches.name }));
  }, [entries, filter, query]);

  // Clamped at read time: the list shrinks as the query narrows, and a stale
  // index must never point past it (Enter would then pick nothing).
  const cursorIndex = Math.min(cursor, Math.max(matches.length - 1, 0));

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${cursorIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursorIndex]);

  const pick = (template: PromptTemplate) => {
    onPick(substituteProjectName(template.template, projectName), template);
    onClose();
  };

  const chip = (id: Filter, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        setFilter(filter === id && id !== "all" ? "all" : id);
        setCursor(0);
      }}
      aria-pressed={filter === id}
      className={cn("shrink-0", filter === id ? "ui-chip-filter-active" : "ui-chip-filter")}
    >
      {label}
    </button>
  );

  return (
    <div
      className={cn(
        "ui-card-shell-raised ui-picker-panel flex flex-col overflow-hidden",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
        <input
          // Only where there is a real keyboard: on a phone, focusing the
          // search raised the soft keyboard over the list being chosen from
          // and moved everything on the page.
          autoFocus={finePointer}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor(Math.min(cursorIndex + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor(Math.max(cursorIndex - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const m = matches[cursorIndex];
              if (m) pick(m.entry.template);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Search prompts — names or the words in them…"
          aria-label="Search your prompts and Loki's library"
          className="ui-tap min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
        />
        {/* Keyboard keys mean nothing on a touch screen. */}
        <span className="hidden shrink-0 text-micro text-text-muted pointer-fine:inline">
          ↑↓ · Enter · Esc
        </span>
      </div>

      <div className="shrink-0 border-b border-border-subtle px-3 py-2">
        <ScrollAffordance childCount={groups.length + 2} threshold={4}>
          <div className="ui-filter-chip-row ui-scroll-fade-right gap-1.5">
            {chip("all", "All")}
            {saved.length > 0 && chip("yours", `Yours (${saved.length})`)}
            {groups.map((g) => chip(g, GROUP_META[g].label))}
          </div>
        </ScrollAffordance>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {matches.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-text-muted">
            {query.trim() ? `No prompt matches “${query}”.` : "Nothing here yet."}{" "}
            <Link href="/prompts" className="underline underline-offset-2">
              Write your own
            </Link>
          </p>
        ) : (
          matches.map(({ entry, nameRanges }, i) => {
            const { template, own } = entry;
            const meta = CATEGORY_META[template.category];
            return (
              <button
                key={`${own ? "own" : "lib"}:${template.id}`}
                type="button"
                data-idx={i}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(template)}
                className={cn(
                  "flex min-h-11 w-full flex-col justify-center gap-0.5 px-3 py-2 text-left transition-colors",
                  i === cursorIndex ? "bg-surface-raised" : "hover:bg-surface-raised",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium text-text-primary">
                    {template.icon ? `${template.icon} ` : ""}
                    {nameRanges ? (
                      <Highlight
                        text={template.name}
                        ranges={nameRanges}
                        markClassName="ui-search-mark"
                      />
                    ) : (
                      template.name
                    )}
                  </span>
                  {own ? (
                    <span className="ui-badge shrink-0">Yours</span>
                  ) : (
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-1.5 py-0.5 text-micro font-medium",
                        "ui-tag-neutral",
                      )}
                    >
                      {meta.label}
                    </span>
                  )}
                </span>
                <span className="line-clamp-1 text-micro leading-snug text-text-muted">
                  {template.description || template.template}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
