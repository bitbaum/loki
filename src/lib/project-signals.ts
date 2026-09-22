/**
 * Provenance for a project attribute, and the one rule that reads it.
 *
 * Lives in lib/ rather than beside the badge component because three surfaces
 * need the same answer — the badge, the attention sort, and the "Site issues"
 * chip — and two of them are not React. A predicate reimplemented per surface
 * is how a project ends up sorted to the top of the page by a flag the row
 * does not display.
 */

export type AttrProvenance = Record<
  string,
  { updatedAt: string; source: string | null; validUntil: string | null }
>;

/**
 * A flag whose author gave it an expiry is over when that expiry passes.
 *
 * This is NOT auto-decay. A flag with no `valid_until` still stands forever,
 * however old — nobody said otherwise, and inventing a deadline for someone
 * else's security note would be worse than showing a stale one. This only
 * honours an instruction already written into the row, which the UI had been
 * ignoring outright: `valid_until` has existed on the attributes table all
 * along and nothing read it, so "expires on the 14th" meant nothing at all.
 */
export function signalHasExpired(
  meta: AttrProvenance | undefined,
  key: string,
  now = Date.now(),
): boolean {
  const until = meta?.[key]?.validUntil;
  if (!until) return false;
  const ms = Date.parse(until);
  // An unparseable date is not an expiry. Treating it as one would silently
  // clear a live security flag on a typo.
  return Number.isFinite(ms) && ms <= now;
}
