/**
 * Welcome changes: a few builds on LOKI'S engine for an account that has
 * brought no engine of its own yet, so the first build happens before the
 * first key is pasted — and a cap in francs so the whole thing can never
 * cost more than the owner decided (docs/master-plan-2026-10.md, decision 5).
 *
 * Both numbers are the owner's and live here only; System → Capacity shows
 * what they cost beside what they brought in. The hard floor is the spending
 * cap set at the vendor on the key itself.
 */

/** Builds a new account may run on Loki's engine before choosing its own. Per account, ever. */
export const WELCOME_BUILDS = 3;

/** The most Loki spends on welcome builds in a calendar month, across every account. */
export const WELCOME_MONTHLY_CAP_CHF = 20;

/**
 * Run cost is recorded in USD at API list rates (orchestration_runs.cost_usd);
 * the cap is in francs. One hand-set rate, named, visible — never a live feed
 * that nobody can read back.
 */
export const CHF_PER_USD = 0.8;

/** The variable the box reads Loki's own key from (the app's env), for a
 *  tenant whose engine is "loki" (scripts/write-tenant-engines.ts). */
export const LOKI_BUILD_ENGINE_KEY_VAR = "LOKI_BUILD_ENGINE_ANTHROPIC_KEY";
