"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Highlight } from "@bitbaum/searchkit/react";
import {
  CATEGORY_META,
  PROMPT_TEMPLATES,
  substituteProjectName,
  type PromptTemplate,
} from "@/config/prompt-library";
import { cn } from "@/lib/utils";
import { PROMPT_SEARCH_SPEC } from "@/lib/prompt-search";
import { searchHits, type Range } from "@/lib/search";

const PICKER_LIMIT = 40;

/**
 * The prompt library as a *picker*, usable wherever a prompt is being composed.
 *
 * Until now the library had two disconnected UIs over one config file: the
 * `/prompts` page (search + run-via-Loki-chat) and Control's collapsible
 * `ProjectPromptLibrary` (featured-only grid that fills a textarea). A prompt
 * you could read on one page could not be sent from the surface you were
 * working on. This component is the third, shared answer: a keyboard-navigable
 * list that resolves `{{project_name}}` and hands back finished text — the
 * caller decides whether that text is typed, dispatched, or previewed.
 *
 * Filtering is by name, description, category label and tags, so "security"
 * finds the category and "deps" finds the tag.
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
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo<{ template: PromptTemplate; nameRanges?: readonly Range[] }[]>(() => {
    const pool = projectScopedOnly
      ? PROMPT_TEMPLATES.filter((t) => t.scope === "project")
      : PROMPT_TEMPLATES;
    if (!query.trim()) {
      // No query → featured first, so the default view is the short useful list
      // rather than 60 rows the user has to read past.
      return [...pool]
        .sort((a, b) => Number(!!b.featured) - Number(!!a.featured))
        .slice(0, PICKER_LIMIT)
        .map((template) => ({ template }));
    }
    // Best match first, and a slip in a word still finds it ("secuirty").
    return searchHits(pool, PROMPT_SEARCH_SPEC, query)
      .slice(0, PICKER_LIMIT)
      .map((hit) => ({ template: hit.item, nameRanges: hit.matches.name }));
  }, [query, projectScopedOnly]);

  // The cursor is clamped at read time rather than reset from an effect: the
  // result set shrinks as the query narrows, and a stale index must never point
  // past the list (Enter would then dispatch nothing).
  const cursorIndex = Math.min(cursor, Math.max(matches.length - 1, 0));

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${cursorIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursorIndex]);

  const pick = (template: PromptTemplate) => {
    onPick(substituteProjectName(template.template, projectName), template);
    onClose();
  };

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
          autoFocus
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
              const t = matches[cursorIndex];
              if (t) pick(t.template);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Search the prompt library…"
          aria-label="Search the prompt library"
          className="ui-tap min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
        />
        <span className="shrink-0 text-micro text-text-muted">↑↓ · Enter · Esc</span>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {matches.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-text-muted">
            No prompt matches “{query}”.
          </p>
        ) : (
          matches.map(({ template, nameRanges }, i) => {
            const meta = CATEGORY_META[template.category];
            return (
              <button
                key={template.id}
                type="button"
                data-idx={i}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(template)}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors",
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
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-1.5 py-0.5 text-micro font-medium",
                      meta.color,
                    )}
                  >
                    {meta.label}
                  </span>
                </span>
                <span className="line-clamp-1 text-micro leading-snug text-text-muted">
                  {template.description}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
