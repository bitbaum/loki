/**
 * A user's own projects plus their org's, each exactly once.
 *
 * getOrgProjects() includes the caller themselves (403f47cd — a solo user's own
 * projects were missing from /control), so `[...own, ...org]` lists every own
 * project TWICE. /control dedupes on its own; the routes that spread the two
 * lists did not, and OrangeCat's actor-status spent half its 25-project cap on
 * duplicates while `loki_fleet_status` reported double the project count.
 *
 * Own rows come first and win; order is otherwise preserved. Pure, so it tests
 * without a database.
 */
export function mergeVisibleProjects<T extends { id: string }>(own: T[], org: T[]): T[] {
  const seen = new Set<string>();
  return [...own, ...org].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}
