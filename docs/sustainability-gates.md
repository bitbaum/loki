# Loki Sustainability Gates

**What this is:** three frozen rules that keep unit economics from inverting as
Loki scales. Derived from the deep business-model analysis of 2026-07-19.
Each gate names a threshold and the machinery that must exist *before* the
threshold is crossed. These are anchors, not aspirations — do not cross a
threshold with the gate still open.

## Why Loki is sustainable today

The model works because the expensive part — agent execution — is offloaded onto
the customer's own machine and their own agent keys (BYO-runner + BYO-keys,
enforced in `src/lib/execution-access.ts`). Loki sells the **captain layer**
(the control plane) for CHF 15–90/mo while the customer pays 100% of the actual
Claude/OpenAI compute. At 10 / 100 / 1000 BYO users, Loki's own marginal
cost is ~one shared Groq key + opt-in Resend email; fixed cost is one box +
Postgres. Break-even is ~2 paid subscriptions. This holds **only** while the
three gates below stay shut.

Current state (2026-07-21): 2 users, 0 paid, CHF 0 revenue-ever. The BTC pass
rail is live end-to-end (`/pricing` → OrangeCat products → HMAC entitlement
webhook → plan grant); revenue observability ships on `/system` (founder-only
`RevenueCard`). The first real sats purchase is the pending anchor.

## Gate 1 — Metering before hosted execution opens beyond the founder

**Threshold:** the moment any non-founder user can run agents on Loki's own
box (i.e. `execution-access.ts` stops being a founder-only allowlist, or
`LOKI_EXECUTOR=sandbox` ships).

**Why:** the pricing ladder gates *project count*, which is uncorrelated with
compute cost. A flat CHF 40/mo Pro user running "build all my projects" autopilot
24/7 on Loki-paid Claude compute burns multiples of their subscription. A
project-count paywall against unmetered autonomous runs inverts unit economics.

**Machinery that must exist first:** per-run cost accounting + a prepaid
credits/metered model (the deferred "Fleet Credits" — port OrangeCat's
`credit-metering.ts` cost×markup pattern rather than reinventing it), plus a
per-user run quota/entitlement gate. Until then, hosted execution stays
founder-only. **This gate is currently SHUT and must stay shut.**

> **Split 2026-10-20** (`docs/master-plan-2026-10.md` §7). The gate's reason
> is Loki-paid compute under a flat plan, so it now reads in two halves:
>
> - Hosted execution **on the person's own engine** — their own subscription
>   signed in, or their own key, inside their own private builder
>   (`docs/architecture/private-builders.md`) — is allowed once that builder
>   exists. Loki pays nothing per build; the gate's reason does not apply.
> - Hosted execution **on Loki's key** — welcome changes and the builds a
>   plan includes — stays gated exactly as above: tokens per run per tenant
>   recorded first, a cap in CHF on the System page second. Shut until both
>   exist.

## Gate 2 — Per-user Groq cap before ~50 active users

**Threshold:** roughly 50 daily-active users (whenever Groq free-tier rate limits
start throttling the shared key).

**Why:** one shared `GROQ_API_KEY` backs Loki fallback, dispatch, vision,
transcription, and digests for *all* tenants (`src/lib/groq.ts`), with no
per-user cap — only Groq's account-level rate limit. A noisy free user degrades
paid users' Loki/transcription, and the paid-Groq-plan cost scales with users but
is priced into nothing.

**Machinery that must exist first:** a per-user daily cap on Groq-backed
endpoints (OrangeCat already ships exactly this shape — the 10/day pattern in its
`cat-plans.ts`), ideally plan-tiered. Cheap to add; add it before it bites.

## Gate 3 — Per-seat Team billing before the first multi-seat Team sale

**Threshold:** the first Team-plan customer with more than ~2 seats.

**Why:** Team is a flat CHF 90/mo tier, and nothing reads a seat count. A
10-person studio pays the same CHF 90 as a 2-person one while consuming ~5× the
Groq/email/support cost. The whitepaper's "up to 10 people" is not enforced
anywhere.

The gate *hardened* when the Stripe rail was removed (#508, 2026-09-06). It used
to name a fixable line — checkout was `quantity: 1` hardcoded in
`src/app/api/stripe/checkout/route.ts`. That route is gone, and the OrangeCat BTC
rail that replaced it is a static per-plan payment URL
(`ORANGECAT_PAY_URL_TEAM`), which carries no quantity concept at all. There is
now no seat number anywhere in the purchase path to correct.

**Machinery that must exist first:** either enforce a seat cap in the app, or
give the Team tier a per-seat purchase path. The BTC rail cannot express seats
on its own, so this is a build, not a config change. Pick one before selling
Team to a real studio.

## The honest holes this does not fix

- **Value capture is thin.** Every Pro/Team perk in the whitepaper ("faster
  inference, priority support") is unenforced marketing; the only code-enforced
  difference between tiers is the project limit. Real differentiators should
  either ship or leave the copy.
- **No trial mechanics, no conversion tracking.** The free tier is the permanent
  funnel entry; nothing measures paid conversion. `RevenueCard` is the first
  step — MRR is now visible; the funnel above it is not yet instrumented.
- **The two-product complement.** Loki has recurring pricing but no usage
  metering; OrangeCat has usage metering (`credit-metering.ts`) but no recurring
  product. Each built the half the other lacks — Gate 1's Fleet Credits is
  OrangeCat's pattern ported inward; OrangeCat's missing Supporter checkout is
  Loki's pass-product pattern ported outward. Solve them together.
