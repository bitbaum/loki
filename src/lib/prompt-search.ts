import { CATEGORY_META, type PromptTemplate } from "@/config/prompt-library";
import type { SearchSpec } from "@/lib/search";

/**
 * How the prompt library is searched, wherever it is searched (the /prompts
 * page and the picker): the name first, then tags and the category's label —
 * so "security" finds the category and "deps" the tag — then the
 * description. Between equal matches a featured prompt leads.
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
