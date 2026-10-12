/**
 * Loki's two ways of answering a search box, both through @bitbaum/searchkit.
 *
 * Every list here used to filter with `text.toLowerCase().includes(q)`: one
 * wrong letter in a project or person name ("lkoi", "jonh") and the thing the
 * operator was reaching for disappeared. searchkit forgives that by word
 * length (none under 4 letters, one from 4, two from 8), matches words while
 * they are still being typed, and folds accents and joined words. The matching
 * lives in the package; this file only decides what a blank query means and
 * which order a list keeps.
 *
 * - `rankByQuery` — the best match first. For lists whose order means nothing
 *   once someone has typed (a picker, a palette).
 * - `filterByQuery` — the matches, in the list's own order. For lists the
 *   operator already ordered (a chosen sort, deadlines, a tree, recency).
 */
import { search, type Hit, type SearchSpec } from "@bitbaum/searchkit";

export type { Hit, Range, SearchField, SearchSpec } from "@bitbaum/searchkit";

/** For a plain list of names (project names in a picker). */
export const TEXT_SPEC: SearchSpec<string> = { fields: [{ name: "text", get: (text) => text }] };

/** Hits for a typed query, best first; empty for a blank one. */
export function searchHits<T>(items: readonly T[], spec: SearchSpec<T>, query: string): Hit<T>[] {
  return query.trim() ? search(items, spec, query) : [];
}

/** The items that match, best first. A blank query returns the list as is. */
export function rankByQuery<T>(items: readonly T[], spec: SearchSpec<T>, query: string): T[] {
  if (!query.trim()) return [...items];
  return search(items, spec, query).map((hit) => hit.item);
}

/** The items that match, in their original order. A blank query keeps them all. */
export function filterByQuery<T>(items: readonly T[], spec: SearchSpec<T>, query: string): T[] {
  if (!query.trim()) return [...items];
  const matched = new Set(search(items, spec, query).map((hit) => hit.index));
  return items.filter((_, i) => matched.has(i));
}
