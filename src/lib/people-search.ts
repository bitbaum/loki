/**
 * Finding a person when the name was typed with a slip.
 *
 * The people search runs in Postgres as `ILIKE '%q%'`, which cannot forgive
 * anything: "jonh" never reaches John, "zurich" never reaches someone filed
 * under Zürich. A person's book is small — hundreds of names, not millions —
 * so the forgiving part runs here, over the names, and hands Postgres the ids
 * it found (`forgivenPersonIds`). The rows that come back are then ordered by
 * what was typed (`rankPeople`), so the person meant is first rather than the
 * one spoken to most recently.
 *
 * Pure: no database, no HTTP. `searchPeople` does the I/O.
 */
import { rerank } from "@bitbaum/searchkit";
import { searchHits, type SearchSpec } from "@/lib/search";

/** The least the name index needs about a person. */
export type PersonNameRow = { id: string; name: string; aliases: string | null };

/** Bound on the ids handed back to SQL: a one-letter query can reach everyone. */
export const FORGIVEN_ID_LIMIT = 200;

const NAME_SPEC: SearchSpec<PersonNameRow> = {
  fields: [
    { name: "name", get: (p) => p.name },
    // Stored as a JSON array string; the tokenizer reads the words out of it.
    { name: "aliases", get: (p) => p.aliases },
  ],
};

/**
 * The people whose name or alias the query reaches — with a typo, an accent
 * left off, or the words run together — best match first.
 */
export function forgivenPersonIds(people: readonly PersonNameRow[], query: string): string[] {
  return searchHits(people, NAME_SPEC, query)
    .slice(0, FORGIVEN_ID_LIMIT)
    .map((hit) => hit.item.id);
}

/** What a person row is ranked on, most telling first. */
type RankablePerson = { name: string; attrs: Record<string, string> };

const attr = (key: string) => (p: RankablePerson) => p.attrs[key] ?? null;

const PERSON_RANK_SPEC: SearchSpec<RankablePerson> = {
  fields: [
    { name: "name", get: (p) => p.name },
    { name: "aliases", get: attr("aliases") },
    { name: "company", get: attr("company") },
    { name: "profession", get: attr("profession") },
    { name: "relationship", get: attr("relationship") },
    { name: "location", get: attr("location") },
  ],
};

/**
 * Rows the database found, best match first. Ties keep the database order —
 * the sort the operator picked — and a row matched on something not ranked
 * here (a channel handle) keeps its place after the ranked ones.
 */
export function rankPeople<T extends RankablePerson>(people: readonly T[], query: string): T[] {
  if (!query.trim()) return [...people];
  return rerank<T>(people, PERSON_RANK_SPEC, query).map((row) => row.item);
}
