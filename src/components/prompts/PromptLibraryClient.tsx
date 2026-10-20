"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { groupForCategory, type PromptTemplate, type PromptGroup } from "@/config/prompt-library";
import { Segmented } from "@/components/ui/segmented";
import { PromptCard } from "./PromptCard";
import { GroupBar } from "./GroupBar";
import { UserPromptsSection, type UserPromptCard } from "./UserPromptsSection";
import type { Project } from "./types";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { PROMPT_SEARCH_SPEC, searchPrompts } from "@/lib/prompt-search";

type ScopeFilter = "all" | "global" | "project";

/** Words match the cards' own scope line ("any project" / "one project"). */
const SCOPE_OPTIONS: { id: ScopeFilter; label: string; means: string }[] = [
  { id: "all", label: "All", means: "Every prompt Loki ships." },
  { id: "global", label: "Any project", means: "Prompts that work in any of your projects." },
  {
    id: "project",
    label: "One project",
    means: "Prompts written for one project — you pick which when you run it.",
  },
];

export function PromptLibraryClient({
  templates,
  projects,
  userPrompts = [],
  timeZone,
}: {
  templates: PromptTemplate[];
  projects: Project[];
  /** v2.1 — user-owned prompts merged from the prompts DB table. */
  userPrompts?: UserPromptCard[];
  /** The person's Loki time zone — the clock scheduled prompts keep. */
  timeZone: string;
}) {
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<PromptGroup | "all">("all");
  const [activeScope, setActiveScope] = useState<ScopeFilter>("all");

  useEscapeKey(() => {
    setSearch("");
    setActiveGroup("all");
    setActiveScope("all");
  });

  // The category counts follow the scope pick, so "Security (3)" is the
  // number you get when you tap it.
  const inScope = templates.filter((t) => activeScope === "all" || t.scope === activeScope);
  const filtered = inScope.filter(
    (t) => activeGroup === "all" || groupForCategory(t.category) === activeGroup,
  );

  // Searching: best match first, a slip in a word forgiven. Browsing: featured
  // first, otherwise the config's category order is preserved (stable sort),
  // so cards still cluster by category within each band.
  const ordered = search.trim()
    ? searchPrompts(filtered, PROMPT_SEARCH_SPEC, (t) => t.template, search).map((h) => h.item)
    : [...filtered].sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false));

  return (
    <div className="space-y-6">
      {/* Search first: one box finds your own prompts AND Loki's, by name,
          tag, description or the words inside them. */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearch("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Search all prompts — names or the words in them…"
          className="ui-input pl-12"
        />
      </div>

      {/* User-owned prompts render first — they grow with use and become more
          relevant than the seed catalog. */}
      <UserPromptsSection
        prompts={userPrompts}
        projects={projects}
        query={search}
        timeZone={timeZone}
      />

      {/* Loki's library and the one control that narrows it. The scope row sat
          beside the search box and the category row a screen further down, so
          two filters on the same list read as two unrelated things (owner,
          2026-10-20) — and the scope one looked as if it narrowed your own
          prompts too, which it never did. Now both sit on the list they
          filter: scope as one even row, categories as one scrolling line. */}
      <section className="space-y-3" aria-labelledby="loki-prompts-heading">
        <div>
          <h2 id="loki-prompts-heading" className="ui-page-subtitle">
            Loki&apos;s prompts
          </h2>
          <p className="text-sm text-text-muted">
            {filtered.length === templates.length
              ? `${templates.length} ready to run`
              : `${filtered.length} of ${templates.length} shown`}
          </p>
        </div>
        <Segmented
          label="Which prompts"
          options={SCOPE_OPTIONS}
          value={activeScope}
          onChange={(id) => {
            const scope = id as ScopeFilter;
            setActiveScope(scope);
            // A category with nothing in the new scope drops out of the row;
            // it must not stay chosen, invisibly, over an empty list.
            if (
              activeGroup !== "all" &&
              !templates.some(
                (t) =>
                  (scope === "all" || t.scope === scope) &&
                  groupForCategory(t.category) === activeGroup,
              )
            )
              setActiveGroup("all");
          }}
        />
        <GroupBar active={activeGroup} templates={inScope} onSelect={setActiveGroup} />

        {ordered.length === 0 ? (
          <div className="ui-empty-panel py-12 text-text-secondary">
            <Search className="h-8 w-8 text-text-muted" />
            <div className="text-lg font-medium text-text-primary">No prompts match</div>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setActiveGroup("all");
                setActiveScope("all");
              }}
              className="ui-btn-secondary min-h-11"
            >
              Show all {templates.length}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {ordered.map((t) => (
              <PromptCard key={t.id} template={t} projects={projects} timeZone={timeZone} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
