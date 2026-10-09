# Models and money

**Date**: 2026-10-09
**Status**: shipped (this document describes what runs; open decisions at the end)

Loki has no merchant account and cannot take a card. It also runs its chat on
a shared pool of free models with a daily budget. Both facts shape how a
person gets *more* out of Loki, and this is the one place the whole shape is
written down — as a system, a product, a business and a screen.

## The three ways Loki runs

| | Who pays | What it buys | Where it is set up |
|---|---|---|---|
| **Free pool** | Nobody | The shared chain of open models, with a daily budget per account | Nothing to do |
| **Your own keys** | You, to your model vendor | Any model your key can reach; the daily budget no longer applies to your chats | Settings → AI |
| **A Loki pass** | You, in Bitcoin, on OrangeCat | Room: the project limit lifts for a month at a time | Settings → Billing, or /pricing |

These are independent. A person on Free with an OpenRouter key runs on the
strongest model they can afford with no pass. A person on a Pro pass with no
key runs on the free pool with more projects. The two cards on the Billing
tab say exactly this, because the question "how do I get a better model" and
the question "how do I get more room" have different answers and a single
"Upgrade" button would send both to the wrong place.

Loki takes no cut of model spend. A key paid to Anthropic is paid to
Anthropic. That is the principle OrangeCat's Cat already runs on
(`config/cat-plans.ts`: free / supporter / byok / credits), and it is why the
keys path exists before the pass path is even priced.

## Your own keys — how it works

```mermaid
flowchart LR
  A[Paste a key] --> B[Probe: the vendor's own model list]
  B -->|refused| C[The vendor's words, nothing stored]
  B -->|works| D[Pick the model, strongest pre-chosen]
  D --> E[Sealed with BYOK_SEAL_SECRET, stored per vendor]
  E --> F[Every chat turn: your chain, your keys]
```

- **One key per vendor, any number of vendors.** `user_model_keys` is keyed
  `(user_id, vendor)` with a `position`. The ordered rows ARE the user's chain:
  the first is where a turn starts; when that vendor is down, over quota or
  refuses, the next answers. The same shape as the free chain
  (`config/chat-models.ts`), on their keys.
- **The composer's model picker shows them first**, marked "Your key", and
  picking one moves that vendor to the front of the chain for that turn
  (`loadOwnModel(userId, startAt)`). A model the server has no key for is
  listed locked, and the last row of the menu is "Add your own key" — the
  picker is never a list of things you cannot have.
- **A key is sealed before it is stored** (`@bitbaum/ai-kit/seal`, context
  `byok`), is never returned by any route (only its last four characters),
  and reaches a request through a per-call environment name
  (`BYOK_API_KEY_<VENDOR>`), never `process.env`. Without `BYOK_SEAL_SECRET`
  the feature says it is not switched on and refuses to store anything in the
  clear.
- **The vendor list is closed** (`BYOK_VENDORS` in ai-kit): OpenRouter,
  OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek, xAI, Together,
  Cerebras. OpenRouter alone reaches every major lab with one key, and the
  settings screen says so. A vendor not on the list is a change to ai-kit,
  not to Loki.
- **Failure is theirs to see.** A revoked key or empty balance comes back as
  a sentence naming the vendor and what it said, with the link to fix it —
  never a silent fall back to the free pool they opted out of
  (`askLokiOnOwnModel` in `lib/loki-core.ts`).

Routes: `GET/PUT/PATCH/DELETE /api/settings/model`, `POST
/api/settings/model/probe`, `GET /api/loki/models`. Migration
`drizzle/0083_user_model_keys_per_vendor.sql`.

## A Loki pass — how it works

Bitcoin has no recurring billing, so a "subscription" is a **time-boxed
pass**: buy a month, it ends, buy another. Nothing renews by itself and
nothing can be charged without the person acting. This is the honest shape
and the screens say it in those words.

```mermaid
sequenceDiagram
  participant U as Person
  participant L as Loki
  participant O as OrangeCat
  U->>L: Settings → Billing → Buy Pro
  L->>O: /products/<pass> (ORANGECAT_PAY_URL_PRO)
  U->>O: pays the Lightning invoice
  O->>L: POST /api/orangecat/entitlement (HMAC, ORANGECAT_WEBHOOK_SECRET)
  L->>L: oc_billing_grants row (external_id unique) + users.plan/expires_at
  L-->>U: Billing shows "Pro · 30 days left"; project limit lifts
  Note over L: crons/downgrade-expired-plans reverts a lapsed pass to free
```

- **OrangeCat side** (already built): the passes are products tagged
  `loki-plan:<plan>` and `loki-days:<n>` (`src/config/loki-passes.ts`,
  seeded by `scripts/seed-loki-passes.ts`); on settlement
  `services/loki/entitlement-notify.ts` signs and posts to Loki. Inert until
  `ORANGECAT_WEBHOOK_SECRET` is set on both boxes.
- **Loki side** (already built): `/api/orangecat/entitlement` verifies the
  signature, records the grant idempotently (`external_id` is unique, so a
  retried webhook is a no-op) and writes the plan with its expiry. The only
  gate a plan enforces today is the project limit (`lib/plan.ts`).
- **The user's side** (this change): the Billing tab shows the plan, the days
  left and the end date, a Buy/Extend button per priced plan that goes to the
  OrangeCat checkout, and every pass that ever landed. A pass bought while one
  is live extends from its end, not from today.
- **The operator's side** (this change): System → Records → Plans lists who
  is on a pass and when it ends, and grants, extends or revokes by hand
  through `POST /api/system/plan-grant` (operator only). A hand grant is the
  same ledger row with `external_id = manual:<uuid>` and no amount, so a
  trial, a pass paid some other way, or a month given for a bug found shows
  up on the person's Billing tab exactly like a paid one. The box-only
  `scripts/grant-plan.ts` remains for an emergency with no browser.

## Why not metered credits (yet)

OrangeCat's Cat sells credits: top up in Bitcoin, spend per request. That is
the right model when the platform *resells* model tokens, because the cost is
per unit. Loki does not resell tokens — the keys path exists precisely so
Loki never sits between a person and their vendor — and the one thing a pass
gates is a count of projects, which is per month, not per unit. So a pass is
the honest first primitive. Credits come back on the table when Loki sells
something metered of its own: hosted builder minutes
(`docs/oc-rail-monetization-scope.md`, option B; ROADMAP "metered pool").

## What needs a decision (George)

The code is complete and the rail is dark only because four numbers and two
secrets are unset. Each is one edit, no code change.

1. **Prices.** `src/config/plans.ts` → `priceMonthly` per plan (CHF), and the
   same figures in OrangeCat `src/config/loki-passes.ts`, then re-run
   `scripts/seed-loki-passes.ts` there. Until then every paid tier reads
   "price to be announced" and no Buy button renders anywhere.
2. **`ORANGECAT_WEBHOOK_SECRET`** — the same value on both boxes. Without it a
   paid pass settles on OrangeCat and nothing reaches Loki (the operator
   would grant it by hand from the card above).
3. **`ORANGECAT_PAY_URL_PERSONAL / _PRO / _TEAM`** on the Loki box — the
   product URLs the seed script prints.
4. **Whose wallet receives it.** The seed script creates the passes under an
   OrangeCat actor; that actor's wallet is where the sats land. The legal
   question of who may receive business revenue is outside this document.
5. **Refunds** are manual in Bitcoin (the operator revokes the pass and sends
   sats back from the receiving wallet). Acceptable at this scale; state it
   on /pricing once prices exist.
6. **Pass length.** Thirty days is the default everywhere (the webhook reads
   `loki-days:<n>`, so a 365-day pass is one more product, not code).

## What was deliberately not built

- No "Upgrade" button on a key-less model row: the row says the server has no
  key and the way out is to add yours, because a pass would not change that.
- No per-plan model gating. Every plan sees the same models; a stronger one is
  a key away for everyone, including Free. Gating models behind a pass would
  resell tokens by the back door.
- No automatic renewal of any kind, and no stored payment method. There is
  nothing to store: the person pays an invoice, or does not.
