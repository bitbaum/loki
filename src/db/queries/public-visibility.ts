/**
 * SSOT for what a SIGNED-OUT visitor is allowed to see.
 *
 * Loki is multi-tenant. The founder is tenant #1, not a special case, so no
 * public surface may resolve "the owner" and publish whatever that account
 * happens to hold. Before this file three different answers to "whose data is
 * public?" were scattered across the codebase:
 *
 *   - the landing hero      → getDefaultUser()            (users.is_default)
 *   - /fleet                → getSelfImprovementTarget()  (oldest entity named "loki")
 *   - the /projects note    → nothing at all — every account saw one box's inventory
 *
 * Three answers is three chances to be wrong, and all three were: each one
 * published a tenant's projects because of who they were rather than because
 * anyone agreed. The tiers below replace all of them.
 *
 * ── The three tiers ────────────────────────────────────────────────────────
 *
 * 1. AGGREGATE — counts across every tenant. Identifies nobody, so it needs no
 *    consent, and it is the only tier that grows honestly with the product.
 *    A visitor should learn how busy Loki is without learning whose work it is.
 *
 * 2. CATALOGUE (/fleet) — projects whose OWNER opted in (listed_publicly).
 *    Everyone who says yes appears; nobody else does.
 *
 * 3. SHOWCASE (landing hero) — the catalogue narrowed to what the OPERATOR
 *    featured (featured_at). A small curated space cannot be first-come, and it
 *    cannot be automatic either.
 *
 * ── Why two gates and not one ──────────────────────────────────────────────
 *
 * They answer to different people. Consent is the owner's and may be withdrawn
 * at any time; featuring is the operator's editorial judgement. So the showcase
 * predicate is consent AND featured — never featured alone. Un-ticking the
 * toggle on a project must remove it from the homepage immediately, without
 * anyone having to remember to un-feature it too.
 *
 * This mirrors site_feedback.featured_at, where the same rule already holds:
 * "raw visitor text NEVER auto-publishes — only rows the operator explicitly
 * featured surface here". Projects now work the way feedback already did.
 *
 * Add a public surface? Read a tier from here. Do not re-derive one: a second
 * copy of the predicate is a second thing to forget when consent is withdrawn.
 */
import { and, eq, isNotNull, type SQL } from "drizzle-orm";
import { userProjects } from "@/db/schema";

/**
 * Tier 2 — the catalogue. The owner said yes, and the project is still live.
 *
 * `isActive` is part of the tier, not an extra: a retired project should leave
 * the shop window without the owner having to revoke consent they still hold
 * for it, in case they bring it back.
 */
export const PUBLIC_CATALOGUE_WHERE: SQL | undefined = and(
  eq(userProjects.listedPublicly, true),
  eq(userProjects.isActive, true),
);

/**
 * Tier 3 — the showcase. Built ON the catalogue predicate rather than beside
 * it, so consent can never be bypassed by featuring: if this were written as
 * `isNotNull(featuredAt)` alone, revoking consent would leave the project on
 * the homepage until somebody noticed.
 */
export const PUBLIC_SHOWCASE_WHERE: SQL | undefined = and(
  PUBLIC_CATALOGUE_WHERE,
  isNotNull(userProjects.featuredAt),
);

/** How many projects the landing hero shows. Curated space is small on purpose. */
export const SHOWCASE_LIMIT = 4;
