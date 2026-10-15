import { CATEGORY_META, type PromptTemplate } from "@/config/prompt-library";
import { searchHits, type Hit, type SearchSpec } from "@/lib/search";

/**
 * How the prompt library is searched, wherever it is searched (the /prompts
 * page and the picker in every message box): the name first, then tags and
 * the category's label — so "security" finds the category and "deps" the tag
 * — then the description. Between equal matches a featured prompt leads.
 *
 * The prompt's own words are searched too, but AFTER these (searchPrompts):
 * people remember what a prompt SAYS as often as what it is called, yet in one
 * spec a word that appears exactly in some prompt's text outranked a name
 * typed with one slip, and "rest fix" stopped finding "Test fix".
 */
export const PROMPT_SEARCH_SPEC: SearchSpec<PromptTemplate> = {
  fields: [
    { name: "name", get: (t) => t.name },
    { name: "tags", get: (t) => t.tags ?? [] },
    { name: "category", get: (t) => CATEGORY_META[t.category].label },
    { name: "description", get: (t) => t.description },
  ],
  rank: (t) => (t.featured ? 1 : 0),
};

/**
 * Matches by name, tags and description first; then the ones found only in
 * the prompt's own words, best first, never twice.
 */
export function searchPrompts<T>(
  items: readonly T[],
  spec: SearchSpec<T>,
  words: (item: T) => string,
  query: string,
): Hit<T>[] {
  const first = searchHits(items, spec, query);
  const seen = new Set(first.map((h) => h.item));
  const inWords = searchHits(
    items.filter((i) => !seen.has(i)),
    { fields: [{ name: "text", get: words }], rank: spec.rank },
    query,
  );
  return [...first, ...inWords];
}

/** A prompt the person saved themselves, as the library lists it. */
export type SavedPrompt = {
  id: string;
  name: string;
  description: string;
  body: string;
  scope: "global" | "project" | "org";
  tags: string[];
  runCount: number;
};

/** The person's own prompts are searched the same way, by the same fields. */
export const SAVED_PROMPT_SEARCH_SPEC: SearchSpec<SavedPrompt> = {
  fields: [
    { name: "name", get: (p) => p.name },
    { name: "tags", get: (p) => p.tags },
    { name: "description", get: (p) => p.description },
  ],
  rank: (p) => p.runCount,
};

/**
 * A saved prompt in the shape the run / schedule modals and the picker use.
 * An "org" prompt has no per-project picker, so it runs as "global".
 */
export function savedPromptAsTemplate(p: SavedPrompt): PromptTemplate {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: "fleet",
    scope: p.scope === "project" ? "project" : "global",
    template: p.body,
    tags: p.tags,
  };
}

/** One row of the picker: Loki's library and your own prompts, together. */
export type PromptEntry = { template: PromptTemplate; own: boolean; uses: number };

export const PROMPT_ENTRY_SEARCH_SPEC: SearchSpec<PromptEntry> = {
  fields: PROMPT_SEARCH_SPEC.fields.map((f) => ({
    name: f.name,
    get: (e: PromptEntry) => f.get(e.template),
  })),
  // Yours first among equal matches, then the ones you run most, then featured.
  rank: (e) => (e.own ? 1000 + e.uses : e.template.featured ? 1 : 0),
};
