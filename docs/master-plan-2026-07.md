# Loki × OrangeCat — Master Plan, Loki Side (July 2026)

> **STATUS — read before acting on this (added 2026-09-22).**
> This is a July 2026 plan, kept for its reasoning. Two of its load-bearing
> facts have since changed:
>
> - **Stripe is gone.** Removed entirely in #508 (2026-09-06): no
>   `src/app/api/stripe/`, no `stripe` dependency in `package.json`. Every
>   sentence below treating Stripe as "coded and ready to flip live" describes
>   a rail that no longer exists. The payment path is the OrangeCat BTC pass.
> - **zellij is gone** (#630), so any dispatch mechanics described in terms of
>   zellij tabs are historical.
>
> Nothing here has been deleted — a plan that was right when written is worth
> reading. Just do not treat its inventory as current.

**Companion to:** `orangecat/docs/business/executive/master-plan-2026-07.md`
(the OC-side plan, written 2026-07-02). The two plans interlock: OC carries
proof and the moat, FC carries revenue and distribution. This document is the
FC half — grounded in a full audit of the codebase, the 54 Thoughts essays,
the architecture specs, production state, and the OC plan itself.

**Supersedes nothing** — `docs/architecture/priority-plan-2026-H2.md` remains
the engineering horizon tracker; this plan re-sequences it against the
business reality and amends one call (see §3.2: Horizon E is no longer
"deferred 6+ months" wholesale — the *control plane* opens now, only *hosted
execution* stays gated).

---

## 1. Ground Truth (2026-07-02)

### Technology (what actually works)

- **Execution spine is real and closed for founder use.** `injectPrompt()` is
  the SSOT dispatch spine; `LocalPtyExecutor` (node-pty, event-sourced, SSE
  resumable) is shared by web, desktop Fleet Runner v0.8.9 (0.8.19 as of
  2026-09-11, when zellij left the product entirely), and the headless
  `loki-box-runner` on Hetzner. The laptop dependency is deleted
  (box-owned-pty P0+P1 shipped 2026-06-26).
- **The cross-product bridge is ~60% built and ahead of its own doc.**
  Parts A (Login with OrangeCat, `users.orangecatActorId`) and C (per-project
  publish + changelog→wall promote, wired into `appendDevLog`, per-user OIDC
  tokens with refresh rotation) shipped 2026-07-02 in PR #55. OC's side (OIDC
  provider, `/api/v1/timeline/publish` ingest, stakeholder graph) is fully
  live. **The loop has never been verified end-to-end in production.**
- **Loki, autopilot loops, prompts library, RAG, frontier digest** — all
  complete and recently hardened (idle nudges through the dispatch spine,
  loop-readiness surfacing, multitenancy execution gating in
  `execution-access.ts`).
- **Zero TODO/FIXME markers in src/ or home/** — unfinished work lives in
  docs, not code litter. Production healthy, deployed same-day as merges.

### Business (what actually exists)

- **Monetization is scaffolded but dark.** Stripe integration, four plan
  tiers (free/personal/pro/team, project limits 3/5/∞/∞), checkout/portal/
  webhook routes — all coded, **zero price IDs configured, no /pricing
  page**. The OC plan explicitly names FC's missing pricing page "a trust gap."
- **One operator (founder dogfood).** Cloud execution is hard-gated to the
  founder allowlist by design — `SandboxExecutor` (box-owned-pty spec P3)
  does not exist yet.
- **Onboarding is an unfinished flow** (flagged inline in `src/app/page.tsx`;
  patched but not completed in `fd213fb`).
- **Public surface is strong**: landing, /thoughts (54 essays), /frontier,
  /roadmap, /mission, /whitepaper, /download, /releases, public profiles.
  The content moat is real and unusual for a pre-1.0 product.

### The vision (what the essays commit us to)

Three-layer stack: models (swappable) → **Loki = capability layer**
(captain mode: command + verify + govern across a fleet of different minds) →
**OrangeCat = economic layer** (+ Solon, governance, later). Strategy in one
line: *"Borrow the workers, own the bridge."* The moat is **governance +
economy + the harness** — not the agents. The named keystone gap
(*The Captain Needs a Ship*): execution must run where the computation is,
not on a borrowed laptop — for **users**, not just the founder.

---

## 2. Diagnosis

1. **The loop exists in code but has never closed with a witness.** FC can
   log in with OC, publish a project, and promote build events to the OC
   wall — as of today, on paper. Nobody has watched a real devlog entry
   appear on orangecat.ch. Until that happens, the "integration is the
   product" story is a claim, not a fact. (Same disease the OC plan
   diagnosed on the money side: 0 payments ever settled.)

2. **FC is positioned as the revenue engine but cannot accept a customer.**
   No pricing page, no configured prices, unfinished onboarding, and — the
   subtle one — the priority plan's Horizon E deferred *all* multi-tenancy
   6+ months because it conflated two different things:
   - multi-tenant **cloud execution** (genuinely gated on `SandboxExecutor` —
     correct to defer), and
   - multi-tenant **control plane with bring-your-own runner** (already
     schema-ready, auth-ready, and safe today: execution happens on the
     *user's* machine via Fleet Runner or their own box; there is nothing to
     sandbox).
   The second is sellable now and is exactly the ICP the essays name: "the
   person already SSHing into a Hetzner VPS to run Claude Code, who wants
   the missing dashboard" (*the-levelsio-pattern*).

3. **The bridge is missing its distribution half.** Part B
   (detect-and-suggest: "Claim your public profile + wallet on OrangeCat")
   is the OC plan's #2 acquisition channel — unbuilt. Promote is
   fire-and-forget with no backfill job, so "best-effort" currently means
   "silently lossy," which the spec explicitly forbids. Existing FC users
   have no way to connect an OC account (only the sign-in button exists).

4. **Trust debt accumulates where nobody is looking.** Runner stalls
   alert but don't recover (B5); the legacy zellij fallback lingered (B6 —
   deleted 2026-09-11);
   orchestration SSOT still has legacy DB fallbacks (B1); deploys have no
   ledger/rollback (D3); roadmap seed sync is a manual step. None of these
   blocks a launch, but each is a future 2 a.m. incident with a paying user
   attached.

---

## 3. Strategy

### 3.1 What Loki is (positioning, held)

The captain, not another worker. Single-agent tools (Claude Code, Codex,
Hermes, OpenClaw) are converging on the worker substrate; Loki bets one
tier up: **see + verify + govern across many agents and projects,
vendor-agnostic**, with cross-model verification a single agent structurally
cannot do (its judge would be itself), plus an economy no worker tool has
(OrangeCat). Positioning doc stands as written.

### 3.2 The one strategic amendment: split Horizon E

**Open the control plane now; keep hosted execution gated.**

- **Tier "Bring your ship" (now):** anyone can sign up, register projects,
  install Fleet Runner (or the headless runner on their own box), and get
  the full captain experience — dispatch, watch, verify, loops, Loki. Their
  compute, their API keys, their risk. This requires *no* SandboxExecutor.
  This is what we charge for first (Stripe, per the OC plan's division of
  labor: "Loki = the revenue engine. Stripe now").
- **Tier "We provide the ship" (next):** hosted ephemeral execution on
  Loki infrastructure — the keystone essay's endgame. Gated on
  `SandboxExecutor` (P3) + metering. This is the upgrade tier and, long
  term, the thing that settles over OC rails instead of Stripe.

This resolves the contradiction between FC's own priority plan (Horizon E
deferred) and the OC master plan (FC carries revenue now) without
compromising on safety: the founder-only gate on *shared cloud execution*
stays exactly where `execution-access.ts` put it.

### 3.3 Division of labor with OrangeCat (accepted as written)

From the OC plan §3.2, adopted verbatim: FC = revenue engine (SaaS, clear
ICP, Stripe now); OC = moat and upside; **the integration is the product** —
build in FC → publish to OC → get funded/paid on OC → fund more building.
FC's obligations under that plan, tracked here: 1.1 ✅ shipped, 1.2 (per-user
tokens — effectively satisfied via OIDC bearer + refresh rotation), 1.3 ✅,
1.4 ✅, 1.5 FC-side read surface (OC wallet/funding state on FC project
pages) — **not built**, 1.6 stale docs — fixed 2026-07-02, 2.3 FC pricing
page — **not built**.

### 3.4 ICP and go-to-market (aligned with OC plan §3.4)

**ICP:** AI-assisted solo builders and micro-studios already shipping with
agents — the levelsio pattern productized. They have a laptop or a VPS, 3–15
projects, and no dashboard. Secondary: the Swiss Bitcoin community via OC.

**Channels, in leverage order:**
1. **The founder's machine as the demo** — every FC project auto-publishes
   build events to OC; the OC timeline becomes living proof. Free,
   differentiated, and *automatic once Phase 0 verifies the loop*.
2. **The Thoughts engine** — 54 essays is a distribution asset most funded
   startups lack. The promised bridge essay (forward-referenced in
   *the-two-halves*) narrates the shipped loop the week it's verified.
3. **OC cross-sell both directions** — bridge Part B detect-and-suggest.
4. **Fleet Runner as the trojan horse** — /download works today; the desktop
   app is the zero-config on-ramp for the BYO tier.

---

## 4. The Plan

Sequencing rule (same as OC's): **one loop closed end-to-end beats ten
features at 80%.** Each phase ends with a public, verifiable proof.

### Phase 0 — Verify the bridge loop, live (days) 🔴

The code shipped today; prove it today. Mirrors OC Phase 0's "one real
payment" with "one real build event."

| # | Item | Owner |
|---|------|-------|
| 0.1 | Live round-trip: sign in to loki.orangecat.ch with OrangeCat in production; confirm `orangecatActorId` persists | Founder (1 click) + Agent verify |
| 0.2 | Publish the Loki project itself to OC via `OrangeCatPublishButton`; confirm the entity + back-link (`orangecatProjectId`) | Agent |
| 0.3 | Append a real devlog entry; watch `promoteDevLogEntry` land it on the OC project wall; screenshot it | Agent |
| 0.4 | Add the **promote backfill/reconcile job** (cron): re-emit unacknowledged promotes; "best-effort must not mean silently lossy" | Agent |
| 0.5 | Settings "Connect OrangeCat" for existing signed-in users (the D2 gap — today only the sign-in button exists) | Agent |
| 0.6 | Tell the OC-side agent its plan's "FC side unbuilt" claims (Phase 1.1/1.3/1.4) are stale — shipped in FC PR #55 | Agent |

**Proof:** the Loki project page on orangecat.ch shows a live stream of
real build events (the OC plan's Phase 1 exit criterion — reachable this week).

### Phase 1 — Open the doors: BYO-runner SaaS (2–3 weeks) 🟠

Everything a stranger needs between "found the landing page" and "paying
customer running their own fleet."

| # | Item | Notes |
|---|------|-------|
| 1.1 | **Finish onboarding**: sign-up → create first project → install runner (desktop or headless) → first dispatch → watch it live. This is priority-plan D2, promoted to the top | The magic moment; measure it |
| 1.2 | **/pricing page + Stripe price IDs** for free/personal/pro/team; flip `isStripeReady()` from dark to live | Closes the OC plan's named trust gap (its item 2.3). **Page SHIPPED 2026-07-08** (`/pricing`, Stripe-aware CTAs, `src/config/plans.ts` SSOT); remaining = founder connects Stripe + sets price IDs → `isStripeReady()` flips it live automatically |
| 1.3 | Per-user agent-token setup documented + surfaced in onboarding (priority-plan D1) | BYO keys = BYO cost = clean unit economics |
| 1.4 | Runner install polish: apt repo / auto-update / headless-box one-liner (D4) + `MissingCLIsBanner` accuracy | The runner IS the activation funnel |
| 1.5 | **Bridge Part B — detect-and-suggest**, both directions ("Claim your public profile + wallet on OrangeCat" post-onboarding) | OC plan's acquisition channel #2 |
| 1.6 | FC project page shows OC wallet/funding state (read via API; defer iframes per spec) | OC plan item 1.5, the FC half |

**Proof:** one external user (not the founder) signs up, connects a runner,
dispatches, and pays. Revenue-ever goes 0 → 1.

### Phase 2 — Hosted execution: the keystone (4–6 weeks) 🟠

*The Captain Needs a Ship*, delivered for users, not just the founder.

| # | Item | Notes |
|---|------|-------|
| 2.1 | **`SandboxExecutor`** (box-owned-pty P3): per-tenant isolation (container per workspace), resource limits, no cross-tenant filesystem | Substrate shipped behind `LOKI_EXECUTOR=sandbox`; next gate is per-user credentials + metering + hosted entitlement |
| 2.2 | Broaden box CLIs (P2): claude/codex/grok alongside hermes, per-user credentials | Cross-model verification needs >1 mind available hosted |
| 2.3 | Metered hosted tier: dispatch-minutes or task-based; Stripe now, **OC rails (credits pattern) as the roadmap demonstration later** — mirrors OC's Cat Credits model | Don't invent a third billing model |
| 2.4 | Hosted-runner (Hermes PR-mode) graduates from spike to a supported "no-runner-yet" fallback for onboarding | New users get a taste before installing anything |

**Proof:** a user with no local runner dispatches a task that executes on
Loki infrastructure, isolated, metered, and billed.

### Phase 3 — Trust hardening (parallel, ongoing) 🟡

Each item is a future incident with a paying customer attached.

| # | Item |
|---|------|
| 3.1 | Runner-stall auto-recover, not alert-only (B5) |
| 3.2 | Deploy ledger + rollback (D3) — we tell users to trust our autonomy story; our own deploys should model it |
| 3.3 | ~~Retire the legacy zellij attach fallback (B6)~~ **done 2026-09-11** (Fleet Runner 0.8.19: zellij, `src/lib/terminals/*`, `home/worker.ts` deleted; the runner owns every PTY) — orchestration legacy DB fallbacks (B1) still open — one truth per state |
| 3.4 | Automate the roadmap-seed sync (kill the manual re-run step) |
| 3.5 | Tests on the new money/identity paths: OIDC RP flow, publish/promote idempotency, Stripe webhook — same rule as OC 4.1: no untested path that moves money or grants identity |

### Phase 4 — Distribution and proof (ongoing, cheap) 🟢

| # | Item |
|---|------|
| 4.1 | Write and publish the promised bridge essay the week Phase 0 verifies ("the first integration ships when the architecture document lands" — it landed; narrate it) |
| 4.2 | Weekly build-in-public cadence: FC events on the OC wall + one essay; the two products marketing each other is the story no competitor tells |
| 4.3 | Priority-plan Horizon C UX items (NL project pre-select, suggested-next-commands, chip→send) as onboarding friction data comes in — pull, don't push |
| 4.4 | Resolve the Loki domain question (loki.com unregistered; the brand decision blocks paid marketing, not the product) |

---

## 5. What "working perfectly" means (success metrics, 90 days)

| Metric | Now | Day 90 target |
|--------|-----|---------------|
| Bridge round-trips verified live (login + publish + promote) | 0 | continuous (backfill job green) |
| FC public projects auto-publishing to OC | 0 | 100% (matches OC plan) |
| External users signed up with a connected runner | 0 | ≥ 10 |
| Paying customers (any tier) | 0 | ≥ 5 |
| Median signup → first successful dispatch | n/a | < 30 min |
| Hosted (sandboxed) dispatches executed for non-founder users | 0 | > 0 |
| Untested money/identity paths | several | 0 |
| Runner stalls requiring manual recovery | all | 0 (auto-recover) |

Technology "perfect" = every advertised loop closes, is tested, and recovers
itself; one SSOT per state; deploys are ledgered and reversible. Business
"perfect" = a stranger can go from landing page to paying captain of their
own fleet without talking to the founder — and their build output gets a
public face, a wallet, and customers on OrangeCat.

---

## 6. Risks & honest constraints

- **SandboxExecutor is genuinely hard** — multi-tenant code execution is a
  security product in itself. Mitigation: BYO tier carries revenue first, so
  hosted execution ships when it's right, not when it's rushed. The substrate
  now exists behind a gate; credentials, metering, and entitlement come before
  broad hosted execution.
- **Two-front solo founder** — the phases interlock with OC's on purpose:
  FC Phase 0 = OC Phase 1's proof; FC Phase 1.5 = OC's channel #2; FC 2.3
  reuses OC's credits pattern. Agents execute nearly everything; the
  founder-only items are: the one-click live login test (0.1), Stripe
  account/price setup (1.2), pricing sign-off, and the domain decision (4.4).
- **Billing-model drift** — Stripe (FC) + Cat Credits (OC) + "settle over OC
  rails someday" is already three stories. Rule: Stripe for FC SaaS now,
  credits for OC intelligence now, convergence is a *roadmap essay* until a
  real customer asks for it.
- **The gate must not silently widen** — opening sign-ups increases pressure
  to "just allow" cloud execution. `execution-access.ts` stays the SSOT; the
  allowlist opens only behind SandboxExecutor.
- **Credibility** (shared with OC plan): 54 essays of honesty are the moat;
  keep labeling roadmap as roadmap. The bridge essay waits for the verified
  screenshot, not the merge commit.

---

## 7. Decisions needed from the founder

1. **Approve the Horizon E split** (§3.2): open multi-tenant control plane +
   BYO runner now; hosted execution stays founder-gated until SandboxExecutor.
2. **Pricing numbers** for personal/pro/team (plumbing is ready; proposal:
   personal ~CHF 15/mo, pro ~CHF 40/mo, team ~CHF 90/mo — anchor against
   "cheaper than one hour of the work it saves," adjust freely).
3. **Do the one-click live test** (Phase 0.1): sign in with OrangeCat on
   production once, so the loop verification can complete.
4. **Stripe account + price IDs** (Phase 1.2) — founder-credentials-only.
5. **Domain**: register loki.com or commit to the current name/domain
   before any paid distribution.
6. **Green-light the bridge essay** once Phase 0's screenshot exists.
