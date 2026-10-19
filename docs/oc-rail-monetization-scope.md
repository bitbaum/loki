# OrangeCat-Rail Monetization — Scope

**Date**: 2026-07-13
**Why now**: Stripe/Payrexx need a registered merchant entity; bitbaum is not a registered entity, so fiat card rails are blocked. Bitcoin rails through OrangeCat need no merchant account and are the on-thesis path ("settle over OC rails, not Stripe"). This scopes the first revenue path that does not wait on incorporation.

**Not in scope**: the legal question of *who may receive business revenue* (any rail, BTC included). That's a Swiss-legal/tax matter for an advisor (bitbaum is unregistered: fleet `registers/org.json`) — it is orthogonal to the payment mechanism below.

---

## 1. What already exists (reuse, don't rebuild)

**Loki**
- Plans `free/personal/pro/team` (`src/config/plans.ts`); the *only* enforced gate is the **project limit** (`src/lib/plan.ts` `PLAN_LIMITS.projects`). Everything else a single builder does is on every tier.
- Entitlement is one write: `updateUserBilling(userId, { plan, planStatus })` → `users.plan` / `users.planStatus` (`src/db/queries/users.ts`). The Stripe webhook used to call exactly this; the rail was removed in #508 (2026-09-06) and `/api/orangecat/entitlement` now performs the same write (the manual `scripts/grant-plan.ts` is the other caller), so the seam this scope depends on is intact.
- Bridge: OIDC scope already includes **`wallet.read`** + `project.*` + `timeline.write` (the `scope:` string on the OrangeCat provider in `src/auth.ts`); FC holds a per-user OC access token (refresh-rotated) and already calls `${OC_BASE}/api/v1/*` with it.
- `/pricing` resolves each plan's CTA at render time (`src/app/pricing/page.tsx`). The `isStripeReady()` branch this scope planned to reuse is gone with the rail (#508); what is left is the BTC path itself, gated on `ORANGECAT_PAY_URL_*` — the "Pay in Bitcoin" CTA is the default case now, not an alternative to add.

**OrangeCat**
- **Cat Credits** (in orangecat: `src/services/cat/credits.ts`, `credit-topup.ts`): a working BTC-topup ledger — user pays a Lightning invoice from OC's platform NWC wallet, settlement is polled via `lookupInvoice`, a `topup` entry is appended (idempotent via `unique(kind, ref=payment_hash)`), balance in BTC. This is the proven "pay BTC → credit an account" machine.
- **Payments/Products** (`src/domain/payments`): `nwc | lightning_address | onchain`, `fixed_price | contribution`, for products/services. v1 exposes `products`, `services`, `investments`, `projects`, `timeline`, etc.
- Loki already *raised* on OC via `investments` — money-in to a Loki OC entity already works.

**The gap**: OC's **v1 public API exposes no payment/purchase/credit endpoint to external callers**. The bridge is publish + read-project only. So FC cannot yet (a) mint a payable link or (b) learn a payment settled. Closing that is the one cross-product dependency.

---

## 2. The shape of the problem

Bitcoin has **no native recurring billing**. So "subscription" becomes one of:
- **Time-boxed pass** — buy "Pro, 1 month/1 year" in BTC; expires; re-buy. (Closest to the current plan ladder.)
- **Prepaid credits** — top up BTC, consume per unit (dispatch-minute, hosted run). (The metered model for *hosted execution*, master-plan Phase 2.)

Given the only enforced gate today is the project limit, the **time-boxed pass** is the right first cut; credits are the right model later, for hosted compute.

---

## 3. Options

### Option A — BTC "pass" purchased on OrangeCat, granted back to FC (RECOMMENDED)
1. Loki lists each paid tier as an OrangeCat **product/service** (or a dedicated `membership`) with a BTC price + period (e.g. Pro = 1 month = N sats).
2. The buyer (already OIDC-linked) pays in BTC via OC's **existing** Lightning/on-chain checkout — zero new payment code.
3. OC **signals FC on settlement** → FC grants: `updateUserBilling(userId, { plan, planStatus:"active", planExpiresAt: now+period })`.
4. A daily cron downgrades expired passes → `free`.

- **Reuses**: all of OC's payment stack; FC's existing entitlement write.
- **New FC**: `users.planExpiresAt` column; an entitlement handler; an expiry cron; a "Pay in Bitcoin" CTA on `/pricing`; a `plan → OC product/price` config map.
- **New OC**: a Loki membership/pass product; **the settlement signal to FC** (see §4).
- **Effort**: FC ~1–2 days · OC ~1–2 days. Honest UX: "Buy a month of Pro in Bitcoin."

### Option B — "Fleet Credits" (mirror Cat Credits)
Prepaid BTC → FC credit ledger → consume per hosted-dispatch/month. This is the metered model the hosted-execution tier wants, but it's a whole ledger + top-up to build on the FC side and overkill for gating project limits today. **Defer to hosted execution (master-plan Phase 2).**

### Option C — Contribution-perk (fastest, crudest)
A BTC contribution to Loki's OC project above a threshold grants a supporter tier for N months. Reuses the raise entirely, but conflates investment/donation with subscription and has no clean per-tier mapping. **Only if we want a demo this week with near-zero build.**

---

## 4. The linchpin: the OC → FC settlement signal

FC must learn "user X paid for tier Y" trustlessly. Two designs:

- **4a. Webhook (push)**: on payment settlement, OC POSTs to a new FC endpoint `POST /api/orangecat/entitlement` with `{ actorId, product, external_id }`, signed (HMAC or the existing OIDC client secret). FC verifies, maps `actorId → userId` (we store `orangecatActorId`), grants. OC already has a webhook delivery service (`src/services/webhooks`). *Preferred — real-time, no polling.*
- **4b. Read endpoint (pull)**: OC adds `GET /api/v1/purchases` (or `/entitlements`) scoped to the bearer's actor; FC polls with the per-user token (a `purchase.read` scope) and grants on new rows. Simpler for OC, but FC must poll and dedupe.

Either way this is **OC-side work** and a shared-contract decision — it's the part that isn't purely a Loki build.

---

## 5. Recommended path + phasing

- **Phase 0 (proof, days)**: Option C or a hand-issued grant — take ONE real BTC payment for a Loki pass through the existing OC checkout, grant the plan manually, confirm `users.plan` flips and the project limit lifts. Revenue-ever 0 → 1 in Bitcoin, no incorporation. Narrate it (Thoughts).
- **Phase 1 (productize)**: Option A end-to-end — the pass product on OC, the settlement webhook (§4a), FC's grant handler + `planExpiresAt` + expiry cron + the "Pay in Bitcoin" CTA.
- **Phase 2 (meter)**: Option B / Fleet Credits when hosted execution ships — BTC top-up → consume per hosted run, settling over the same rail.

## 6. Open decisions (yours / cross-product)
1. **Primitive**: pass (A) vs credits (B) vs contribution (C) for the first cut. (Recommend A, with a C-style manual grant for Phase-0 proof.)
2. **Signal**: webhook (4a) vs poll (4b). (Recommend 4a — OC already has webhook delivery.)
3. **Pricing in BTC**: fixed sats per tier, or CHF-pegged converted at purchase? (Volatility vs simplicity.)
4. **Whose wallet receives it** — the platform NWC wallet Cat Credits already uses, or a Loki-specific wallet? (Ties back to the legal/entity question — flag, don't decide here.)
5. **Refunds** in BTC are manual — acceptable at this stage?
