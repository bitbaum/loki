// Which OrangeCat project links actually resolve.
//
// WHY THIS EXISTS: `user_projects.orangecat_project_id` records a link made at
// some point in the past. OrangeCat is a separate product with its own
// database and its own deletions, so the id can outlive the thing it points
// at. On 2026-09-11 two of six such links on /fleet returned 404 — the chip
// said "OrangeCat", the reader clicked, and got nothing. A register that
// renders a link it has not checked is asserting something it does not know.
//
// Same shape as ./solon.ts on purpose: probe the candidates, remember the
// answer briefly, and keep UNCHECKED distinct from "does not exist" — a
// network failure must never silently downgrade a live profile to absent.

const OC_BASE = process.env.ORANGECAT_BASE_URL ?? "https://orangecat.ch";
const TTL_MS = 10 * 60 * 1000;
/** An incomplete answer is asked again soon: a bad minute on their side must
 *  not keep true links off the published map for ten. */
const UNCHECKED_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 2500;

type Cache = { at: number; live: Set<string>; verified: Set<string>; checked: boolean };
let cache: Cache | null = null;

/** Reset between tests; the module-level cache would otherwise leak across them. */
export function __resetOrangecatCache() {
  cache = null;
}

/**
 * Of the given OrangeCat project ids, the ones whose public page answers.
 * `checked` is false when at least one probe could not be completed, in which
 * case a caller should show the link rather than hide a profile that probably
 * exists — an unreachable OrangeCat is our problem, not the project's.
 *
 * `verified` is the stricter set: only the ids whose page ANSWERED. A page
 * Loki renders itself may show an unchecked link and say so; a link Loki
 * PUBLISHES for other sites to copy (the fleet map) is taken from here, so
 * nothing leaves this product that was not seen to exist.
 */
export async function orangecatProjectsThatResolve(
  ids: Iterable<string>,
  now = Date.now(),
): Promise<{ live: Set<string>; verified: Set<string>; checked: boolean }> {
  const wanted = [...new Set(ids)].filter(Boolean);
  if (
    cache &&
    now - cache.at < (cache.checked ? TTL_MS : UNCHECKED_TTL_MS) &&
    wanted.every((id) => cache!.live.has(id) || cache!.checked)
  ) {
    return { live: cache.live, verified: cache.verified, checked: cache.checked };
  }
  const live = new Set<string>();
  const verified = new Set<string>();
  let checked = true;
  await Promise.all(
    wanted.map(async (id) => {
      try {
        const res = await fetch(`${OC_BASE}/projects/${encodeURIComponent(id)}`, {
          method: "HEAD",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) {
          live.add(id);
          verified.add(id);
        }
        // A 404 is an answer: the project is gone. Anything else (502, 429,
        // a timeout) is not, and must not be read as deletion.
        else if (res.status !== 404) {
          checked = false;
          live.add(id);
        }
      } catch {
        checked = false;
        live.add(id);
      }
    }),
  );
  cache = { at: now, live, verified, checked };
  return { live, verified, checked };
}

/**
 * Drop every OrangeCat project link that was not seen to exist, in place.
 *
 * WHY THIS EXISTS: /fleet checked its links and the fleet map did not. The map
 * is what OrangeCat's home page and /ecosystem, bitbaum and the assistant
 * read, so on 2026-11-13 Bitbaum's tile on orangecat.ch opened
 * /projects/<id>, a page that had been deleted there. The stored id is a
 * record of a link made once; the map is a statement made now.
 *
 * Stricter than the register page on purpose: an unreachable OrangeCat means
 * no link this time, not a link on trust. The project's own site is always in
 * the map beside it, so the reader still has somewhere true to go.
 */
export async function keepVerifiedOrangecatLinks<
  T extends { orangecat?: { projectId: string } | null },
>(rows: T[]): Promise<T[]> {
  const ids = rows.map((r) => r.orangecat?.projectId).filter((id): id is string => !!id);
  if (ids.length === 0) return rows;
  const { verified } = await orangecatProjectsThatResolve(ids);
  for (const r of rows) {
    if (r.orangecat && !verified.has(r.orangecat.projectId)) r.orangecat = null;
  }
  return rows;
}
