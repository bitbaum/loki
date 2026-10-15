"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { groupForCategory, type PromptTemplate, type PromptGroup } from "@/config/prompt-library";
import { PromptCard } from "./PromptCard";
import { GroupBar } from "./GroupBar";
import { UserPromptsSection, type UserPromptCard } from "./UserPromptsSection";
import type { Project } from "./types";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { PROMPT_SEARCH_SPEC, searchPrompts } from "@/lib/prompt-search";

export function PromptLibraryClient({
  templates,
  projects,
  userPrompts = [],
}: {
  templates: PromptTemplate[];
  projects: Project[];
  /** v2.1 — user-owned prompts merged from the prompts DB table. Optional
   *  for backward compat with callers that haven't been updated yet. */
  userPrompts?: UserPromptCard[];
}) {
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<PromptGroup | "all">("all");
  const [activeScope, setActiveScope] = useState<"all" | "global" | "project">("all");

  useEscapeKey(() => {
    setSearch("");
    setActiveGroup("all");
    setActiveScope("all");
  });

  const filtered = templates.filter((t) => {
    if (activeGroup !== "all" && groupForCategory(t.category) !== activeGroup) return false;
    if (activeScope !== "all" && t.scope !== activeScope) return false;
    return true;
  });

  // Searching: best match first, a slip in a word forgiven. Browsing: featured
  // first, otherwise the config's category order is preserved (stable sort),
  // so cards still cluster by category within each band.
  const ordered = search.trim()
    ? searchPrompts(filtered, PROMPT_SEARCH_SPEC, (t) => t.template, search).map((h) => h.item)
    : [...filtered].sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false));

  return (
    <div className="space-y-6">
      {/* Search first: one box finds your own prompts AND Loki's, by name,
          tag, description or the words inside them. It used to sit below your
          prompts and search only Loki's. */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
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
        <div className="flex shrink-0 gap-1.5">
          {(["all", "global", "project"] as const).map((scope) => (
            <button
              key={scope}
              onClick={() => setActiveScope(scope)}
              className={activeScope === scope ? "ui-chip-filter-active" : "ui-chip-filter"}
            >
              {scope === "all" ? "All" : scope === "global" ? "Global" : "Project"}
            </button>
          ))}
        </div>
      </div>

      {/* User-owned prompts render first — they grow with use and become more
          relevant than the seed catalog. */}
      <UserPromptsSection prompts={userPrompts} projects={projects} query={search} />

      <GroupBar active={activeGroup} templates={templates} onSelect={setActiveGroup} />

      {ordered.length === 0 ? (
        <div className="ui-empty-panel py-12 text-text-secondary">
          <Search className="h-8 w-8 text-text-muted" />
          <div className="text-lg font-medium text-text-primary">No prompts match your filters</div>
          <div className="max-w-xl text-base text-text-secondary">
            Try a broader search or clear one of the active filters.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {ordered.map((t) => (
            <PromptCard key={t.id} template={t} projects={projects} />
          ))}
        </div>
      )}
    </div>
  );
}
