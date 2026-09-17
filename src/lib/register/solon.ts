// Which projects have a Solon organisation — by consent, not by name.
//
// Solon is its own product with its own database; Loki must not read it
// directly. Solon publishes `GET /api/orgs`: every organisation, and the Loki
// project each one governs (`claimedProject`). A claim exists only when the
// founder arrived from that project's page carrying a grant Loki signed for
// their own OrangeCat identity (src/lib/integrations/solon-grant.ts), so a claim
// means the project's owner founded the organisation for it.
//
// This used to probe `GET /api/orgs/<slug>` for each slug it already knew — and
// every caller passed no slugs, so it only ever probed `orangecat`. An
// organisation for any other project could exist and the register would never
// have seen it. And now that anyone may found an organisation, a name match is
// the wrong question anyway: an organisation called `loki` is not Loki's.
//
// A fetch that fails is reported as UNCHECKED, never as "no organisation": the
// two must look different to a consumer.

export const SOLON_BASE = process.env.SOLON_BASE_URL ?? "https://solon.orangecat.ch";
const TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 2500;

export type SolonOrgListing = { slug: string; claimedProject: string | null };

type Result = { claims: Map<string, string>; checked: boolean };
let cache: (Result & { at: number }) | null = null;

/**
 * Project slug → the slug of the organisation that claims to govern it.
 *
 * Pure, so the one rule that matters here is testable without a network: an
 * organisation that claims nothing governs nothing, whatever it is called.
 */
export function claimsFrom(orgs: readonly SolonOrgListing[]): Map<string, string> {
  const claims = new Map<string, string>();
  for (const o of orgs) {
    if (o.claimedProject) claims.set(o.claimedProject, o.slug);
  }
  return claims;
}

export async function solonClaims(now = Date.now()): Promise<Result> {
  if (cache && now - cache.at < TTL_MS) return { claims: cache.claims, checked: cache.checked };
  try {
    const res = await fetch(`${SOLON_BASE}/api/orgs`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { organizations?: SolonOrgListing[] };
    if (!Array.isArray(body.organizations)) throw new Error("no organizations list");
    cache = { at: now, claims: claimsFrom(body.organizations), checked: true };
  } catch {
    // Keep the last good answer if there is one — but say it was not checked.
    cache = { at: now, claims: cache?.claims ?? new Map(), checked: false };
  }
  return { claims: cache.claims, checked: cache.checked };
}
