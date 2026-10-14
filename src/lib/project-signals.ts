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

/**
 * Copied in from another store. A row with this source is a snapshot of what
 * something used to say, not a fact anyone has checked in Loki. Re-saving the
 * note in the UI changes the source, and that is the confirmation.
 */
export const UNCHECKED_IMPORT_SOURCES = new Set(["knowledge.sqlite"]);

/**
 * Sentences that used to be true of a product and are not.
 *
 * They keep coming back because an old note, an old guide, or an old import
 * states them in the present tense, and the next agent treats that as the
 * job. A short sentence that already says the claim is retired is the
 * correction, not another copy of the claim.
 *
 * The phrases are the same ones `bitbaum/fleet` `registers/retired.json`
 * forbids in public docs. This is the runtime half: a profile must not brief
 * an agent with a sentence the docs are no longer allowed to say.
 */
const NEGATED =
  /\b(never|not|no longer|isn't|is not|does not|don't|retired|legacy|historical|superseded)\b/i;

const RETIRED_SYSTEM_CLAIMS: RegExp[] = [
  /@revamp-it\.ch\b[^.]{0,120}\b(staff|admin)\b/i,
  /\b(staff|admin)\b[^.]{0,120}@revamp-it\.ch\b/i,
  /anyone (?:who )?can register[^.]{0,80}@revamp-it\.ch/i,
  /\(port\s*3001\)/i,
  /\b(cms|express|vercel|frontend)\b[^.]{0,60}port\s*3001/i,
  /port\s*3001[^.]{0,60}\b(cms|express|vercel|frontend)\b/i,
  /revampit\.vercel\.app/i,
  /revamp-?it is a swiss non-profit/i,
  /only the frontend[^.]{0,60}vercel/i,
  /frontend[^.]{0,40}\bon vercel\b/i,
];

export function isRetiredSystemClaim(text: string | null | undefined): boolean {
  const t = text?.trim() ?? "";
  if (!t) return false;
  if (t.length < 500 && NEGATED.test(t)) return false;
  return RETIRED_SYSTEM_CLAIMS.some((re) => re.test(t));
}

/** Drop sentences that restate a retired fact. The rest of the text stays. */
export function withoutRetiredClaims(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((part) => part.trim() && !isRetiredSystemClaim(part));
  return kept.join(" ").trim();
}

/**
 * May this sentence be handed to an agent as a fact?
 *
 * An unchecked import is memory. A retired claim is a finished argument.
 * Neither is a task. A note someone wrote in Loki, with no expiry, still is —
 * including an old one. Age alone is not a reason to hide a security note.
 */
export function factReachesAgent(
  value: string | null | undefined,
  source: string | null | undefined,
): boolean {
  const v = value?.trim();
  if (!v) return false;
  if (source && UNCHECKED_IMPORT_SOURCES.has(source)) return false;
  if (isRetiredSystemClaim(v)) return false;
  return true;
}

/**
 * A flag that still costs health, sorts the list, and can be dispatched.
 * Same rule as {@link factReachesAgent}, plus an expiry the author already set.
 */
export function signalIsLive(
  meta: AttrProvenance | undefined,
  key: string,
  value: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!value?.trim()) return false;
  if (signalHasExpired(meta, key, now)) return false;
  return factReachesAgent(value, meta?.[key]?.source ?? null);
}
