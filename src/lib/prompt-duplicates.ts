/**
 * Exact-duplicate saved prompts (same name + body), collapsed for display.
 *
 * Plain module, not the client section: /prompts' server page counts with the
 * same rule its section renders with, and a function exported from a
 * "use client" file cannot be called on the server.
 */

type Named = { name: string; body: string };

/** \u0000 escape, not a literal NUL: the raw byte made the file read as
 *  binary to grep, diff and most editors. */
export const dupeKey = (p: Named) => `${p.name}\u0000${p.body}`;

/**
 * Collapse exact duplicates and count how many there were.
 *
 * A smoke session once forked the same default six times and the section
 * rendered "Next Best Step" ×7, so this dedupes at render and the newest copy
 * wins (the list arrives most-recent first).
 *
 * It returns the COUNT as well, because hiding the copies silently made delete
 * look broken: the card stands for a whole group, so deleting it drew the next
 * identical row in its place and the prompt appeared to come back. Measured on
 * prod 2026-09-18: 8 rows named "Next Best Step", two groups of four, rendering
 * as two cards over a header that said "2 saved".
 */
export function collapseDuplicates<T extends Named>(
  prompts: T[],
): { visible: T[]; copies: Map<string, number> } {
  const copies = new Map<string, number>();
  for (const p of prompts) copies.set(dupeKey(p), (copies.get(dupeKey(p)) ?? 0) + 1);
  const seen = new Set<string>();
  const visible = prompts.filter((p) => {
    const key = dupeKey(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { visible, copies };
}
