# Loki master plan — October 2026: from one builder to many

**Status:** PLAN, proposed 2026-10-20 and the same day turned from five
phases into one build (§3) at the owner's direction: build the end game now,
not in steps a human team would pace. Nothing in it is live yet. The build
starts with the first PR below.
**Supersedes:** `master-plan-2026-07.md` on sequencing and on money (kept for
its reasoning; its Stripe and "hosted execution is 4–6 weeks of containers"
assumptions are gone). **Amends:** `sustainability-gates.md` Gate 1 (§7).
**Detail for Track 1:** `architecture/private-builders.md`. **What runs today
for chat and passes:** `architecture/models-and-money.md`. **Builders from
Bitbaum:** `architecture/builders-and-booking.md`.

## 0. One paragraph

Loki today builds for one person, on one Linux user, with that person's
Claude sign-in, database password and GitHub token in every agent's
environment. Anyone given a seat on one of that person's projects builds
on that person's subscription; anyone who signs up fresh cannot build at
all. The plan is to turn that one builder into one builder **per account**
on the box Loki already rents, under one rule — *whoever asks for a change
pays for it, with their own engine, in their own builder* — and in the same
build to take the first franc, open the door to builders found on Bitbaum,
and seal each build in its own throwaway container. It is one build, landed
as a chain of pull requests in dependency order, each exercised on the live
box before the next stacks on it. Hosting cost stays at CHF 0 above today's
until a number on the System page says otherwise.

## 1. Where we are (2026-10-20)

**What works.** One operator dogfoods the whole loop daily: Loki chat →
dispatch → a box-runner PTY on Hetzner → PR → auto-merge → deploy → a
walkthrough of the change on the live page. Visitors' notes become fixes.
Sign-in is OrangeCat for Loki, Solon, Heidi and evig. Prices are decided
(CHF 15 / 40 / 90) and the Bitcoin pass rail is built and dark. A person's
own model key powers Loki's chat and nobody else's. The roadmap, changelog
and whitepaper are records the site renders, not prose.

**What is wrong** (four independent code passes, 2026-10-19; detail in
`architecture/private-builders.md` § Why now):

1. One builder, one identity: the runner is `ubuntu` with the owner's
   `~/.claude`, `DATABASE_URL` and `GITHUB_TOKEN`, inherited by every agent.
2. A seat on a project spends the owner's subscription. The per-site
   allowance shipped on 2026-10-19 rationed that leak instead of closing it.
3. A fresh account cannot build: every path ends in `cloud-builder-private`,
   and the kickoff screen then sends them to install Fleet Runner, which fails
   the same way.
4. Chat and build are different engines (free pool or own key for the brain;
   an agent CLI's own sign-in for the hands). This one is right and stays.

**Money.** No company registered yet, so no invoice and no OrangeCat pass
can be issued in Loki's name. Revenue ever: CHF 0. The owner's own
subscriptions (Claude Max, ChatGPT Plus, Grok, roughly CHF 250 a month
together) build only his own work from Track 1 on. The box is a CX43 at
about CHF 17 a month.

**People.** The owner; Manu, whose site Petvity is the first real seat; the
Bitbaum studio's partners, who today have a private link and no account.

## 2. The rule, and what follows from it

**Whoever asks for a change pays for it, with their own engine, in their
own builder.**

An *engine* is one of three things, in the order a newcomer meets them:

| Engine | Who pays whom | Where it is set up |
|---|---|---|
| **Their own subscription** | Them, to Anthropic / OpenAI / xAI / Cursor | `/login` inside their own Sessions page, the way the owner does today |
| **Their own API key** | Them, to the vendor | Settings → Your engine, one key marked "for building" |
| **A Loki plan** | Them, to Loki; Loki, to its vendor | `/pricing`; a bounded number of builds a month on Loki's key |

A *builder* is the Linux user, home and runner unit that belongs to one
account on the box (Track 1), or Fleet Runner on their own machine (today).

What follows:

- **A request from someone with no engine is a suggestion**, filed to the
  project's owner with one line on how to get an engine. It never builds on
  anyone else's.
- **The free pool is a tasting menu, never a plan.** For chat it already is
  (`lib/ai-budget`). For building, the only free thing is *welcome changes*:
  a few builds on Loki's own key for a new account, under a monthly cap in
  CHF that the owner sets and the System page shows.
- **A plan is a metered engine, not an unlimited one.** The number of builds
  a plan includes is set *after* two weeks of readings from Track 1 (tokens
  per run per tenant), not guessed now. A plan can never inherit an
  open-ended model bill; that is the whole point of Gate 1.
- **Loki takes no cut of model spend.** A key paid to a vendor is paid to
  that vendor. Loki sells the control plane, the seat, the room and, inside a
  plan, a bounded allowance it buys wholesale.
- **The chat brain stays separate from the building hands.** The model a
  person brings for Loki's chat (`user_model_keys`) does not run their
  builds unless they mark it "for building". A stronger brain makes a better
  steer; it does not change who pays for the hands.

## 3. One build, in merge order

The first draft of this plan had five phases and "about two weeks" beside
each. The owner's answer was the right one: there is no human team here,
and a phase that costs nothing has no reason to wait for the one before it.
So it is **one build**. What remains of "order" is only what the work itself
forces:

- **Each change to the box lands on the live box and is exercised there
  before the next one stacks on it.** There is no second box, and the
  sandbox this is written from cannot reach the box except through a
  deploy. That is minutes per step: CI, the deploy, one dispatched test.
- **A pull request that stacks on an unmerged one cannot be verified
  against main.** The fleet merges one PR per sweep, each proven against
  the main it branched from. So the chain is sequential by construction,
  and the way to go faster is fewer, larger PRs that each pass `verify`,
  not more PRs in flight.
- **The leak is closed first** because it is the only item that costs the
  owner money each time it happens, and it is app-only.

Everything that is code is built now, in this order of merging (the tracks
in §4 are tracks, not phases, and are worked in parallel up to the point
where a PR depends on the one before it):

1. Stop the leak and the routing lies (app).
2. Agent environment allowlist; runner reads projects through the API and
   carries no database password (runner).
3. One unit per tenant with a token per user; the owner on the same
   template; the eligibility flag; Sessions per tenant (box + app).
4. Settings → Your engine; tokens per run recorded; welcome changes; builds
   inside plans; honest onboarding; the Capacity card (app).
5. A container per build inside each tenant's unit, gVisor where the box
   allows it (box + runner).
6. Builder profiles, assignment → seat, the fee as the builder's own
   OrangeCat service (app + OrangeCat).
7. Code for a pool of boxes, dormant until a second box exists.

### What is genuinely not mine to speed up

- **A microVM per build** needs `/dev/kvm`. Hetzner's cloud servers do not
  expose nested virtualisation, so on the CX43 the sealed build is a
  container under gVisor, whose user-space kernel does not need KVM. The
  microVM arrives with a dedicated box, when the capacity numbers ask.
- **Money in Loki's own name** needs the company. Until then the first
  franc is a pass granted by hand with a note; the Bitcoin rail is built
  and switches on the day the company can receive.
- **People.** Manu signing in to his own builder, a partner appearing on
  Bitbaum, a stranger paying — each is a person's act. The build makes
  each of them a five-minute task with the exact link and taps.
- **A second box** costs money, so it waits for System → Capacity to show
  a queue. Its code does not.

## 4. The build, by track

### Track 0 — Stop the leak and the lies (app only)

| # | Work | Proof |
|---|---|---|
| 0.1 | A request on a shared project from a seat with no engine becomes a **suggestion** to the owner; `config/client-allowance.ts`, `on_allowance` and the per-site allowance UI are retired; "Make it live" and the member pass stay | A second account with a seat on Petvity asks for a change; the owner sees a suggestion, no build runs, the reply names the way forward |
| 0.2 | **Routing honesty**: a project with no stored builder on an account without cloud routes to its connected Fleet Runner; the kickoff never writes a path under the global dev root for an account that has none; "Hosted runner" is offered only to accounts it serves | A fresh account with Fleet Runner connected kicks off a project and the build runs on their machine |
| 0.3 | The 40-builds-a-day cap reads as "per account, on that account's engine" | `scripts/test/execution-access.ts` extended with the real dispatch path |
| 0.4 | New repositories a tenant's project creates go into the bitbaum GitHub org only when the tenant is the owner; otherwise the project's own `gitUrl` | Covered by the same test |

**Cost:** CHF 0. **Records:** changelog entry in the words of the person it
affects ("Your requests on a shared project now go to its owner as a
suggestion unless you have your own way to build"); roadmap milestone 2 of
Private builders ticked.

### Track 1 — Private builders (`private-builders.md`, PRs 2–7)

| # | Work | Proof |
|---|---|---|
| 1.1 | Agent PTYs get an **allowlisted environment** (`PATH HOME TERM LANG USER` + the spec's own), never `process.env`. Applies to the owner's runner first | A dispatched agent prints `env`; the test asserts the allowlist; the owner still builds |
| 1.2 | The runner **reads projects through the API** with its token and carries no `DATABASE_URL`; clones use a GitHub token served per run | A clone-on-demand dispatch on the box with the variable removed |
| 1.3 | **`new-tenant.sh <userId>`**: a system user `lk-<short>`, its home and dev root, a `loki-box-runner@<tenant>` unit (`ProtectSystem=strict`, `ProtectHome=tmpfs` + its own home bound, `/opt/loki` and `/home/ubuntu` inaccessible, `MemoryMax=3G`, `CPUQuota=200%`), a token minted for that user. The owner's runner moves onto the same template; `migrate-box-runner-to-fcrunner.sh` and `harden-box-runner.sh` retire | A test tenant of the owner's signs in to Claude Code in its own home from the web Sessions page, dispatches, builds; `sudo -u lk-test cat /opt/loki/app/.env` is refused; a deploy restarts every unit |
| 1.4 | **Eligibility is a flag** (`users.private_builder`), separate from the founder-only fleet powers; `LOKI_CLOUD_BUILDER_USER_IDS` retires; the two "operator" definitions unify on `users.isDefault` | `execution-access.ts` |
| 1.5 | **Settings → Your engine**: a vendor key marked "for building" reaches the tenant's unit environment on the next restart; `/login` in their own Sessions signs in their subscription. Both are explained on one screen in plain words: what it costs, who bills, how to stop | A key marked for builds reaches the unit env and a build runs on it |
| 1.6 | **Tokens per run per tenant** recorded from the agent's own usage line and shown on the run — the reading Track 2's numbers are set from | Two weeks of rows on System → Capacity |
| 1.7 | **Manu**: `new-tenant.sh` for his account, his seat on Petvity set to "can change it", his own sign-in or key. The first real tenant is the acceptance test of the track | Manu changes Petvity himself; the owner's subscription shows no build of his |

**Cost:** CHF 0. **Records:** one changelog entry per shipped PR; the essay
*Whoever asks pays* (the rule, why the allowance was the wrong fix, what a
private builder is in plain words) when 1.3 ships; whitepaper Architecture
line changed from "the always-on cloud builder for accounts that have
access to it" to "a private builder per account on Loki's cloud, or Fleet
Runner on your own machine", version bumped, when 1.4 ships.

### Track 2 — Engines and the first franc

| # | Work | Proof |
|---|---|---|
| 2.1 | **Welcome changes**: a new account gets N builds on Loki's own key (a vendor key the operator funds, with a spending cap set *at the vendor*), counted per account, shown on Settings → Your engine with "N left, then your own engine or a plan". A site-wide monthly cap in CHF on System → Revenue, beside what it brought in | A fresh account builds its first change with nothing set up; the counter falls; the cap holds |
| 2.2 | **Plans include builds**: `PLAN_LIMITS.buildsMonthly` per tier, on Loki's key, with a per-build token ceiling; past it, the person's own engine. Numbers set from the Track 1 readings | `/pricing` states them; `lib/plan.ts` enforces them |
| 2.3 | **The first franc, by hand**: a pass granted from System → Plans after a payment the owner accepts any way he can today (bank, TWINT, Bitcoin to his own wallet), written on the grant as a note. The Bitcoin rail (`LOKI_PAYMENTS_OPEN`, the OrangeCat passes, the webhook secret) switches on the day the company exists and can receive in its own name | System → Revenue shows one pass with an amount |
| 2.4 | **Per-user chat cap on the shared key** (Gate 2), already the shape in `lib/ai-budget`; confirmed plan-tiered | A noisy free account cannot empty the pool for a paid one |
| 2.5 | **Onboarding says the truth**: sign-up → first project → "Build it where?" with three honest choices (your own machine, your private builder, welcome changes) → first build → watch it | A stranger reaches a running build in under ten minutes without a message to the owner |

**Cost:** the welcome cap, CHF 20 a month proposed (§9), funded at the
vendor and visible beside revenue. **Records:** changelog per PR; `/pricing`
and the whitepaper's Plans section updated the day 2.2 lands.

### Track 3 — Builders through Bitbaum

| # | Work | Proof |
|---|---|---|
| 3.1 | A builder is an **OrangeCat account with a Loki tenant** (Track 1) and a public builder profile; Bitbaum's `/builders/` renders it from Loki's public data, the way the catalogue renders from `/api/fleet/map`. No org membership — the unit of involvement is the project (`builders-and-booking.md`) | A partner signs in, gets a tenant, appears on Bitbaum |
| 3.2 | **Assigning a builder grants the seat** on that one project, revocable; the builder builds in their own tenant on their own engine | The seat's builds run under `lk-<builder>`, never under the owner's |
| 3.3 | **The fee** is the builder's own OrangeCat service; the client pays it to the builder's wallet when they accept the work. Loki holds no money | One real assignment paid end to end |
| 3.4 | **The words on the screens** for the three people around a project (the one who owns it, the one with a seat, the one booked to build) are settled here, with the screens that need them, from first principles across Bitbaum, Loki, OrangeCat and Solon. This plan uses descriptions, not names, on purpose | The owner reads each screen cold and is not confused |

**3.4, first word settled (2026-10-30).** The one booked to build is a
**builder** — an *approved builder* wherever "build it yourself" sits beside
it. Not "partner": that read as co-ownership or a revenue share, which is not
on offer, and it is what vendors call each other. The line around it is
**builders in the loop**: agents do the typing, a builder owns the judgement —
the owner on their own Loki, an approved builder, or the studio's own. Bitbaum's
`/builders/` (with `/partners/` forwarding), Loki's build paths, chat and
application screens say it now; the reasoning is in Bitbaum's
`site/PURPOSE.md`. Identifiers other systems read (`kind: "partner"`,
`/api/studio-partners`, `/studio/partner`) keep their names. The words for the
owner and the one with a seat are still open.

**Cost:** CHF 0. **Records:** roadmap "Builders on other people's sites"
moves to Now; an essay when 3.3 ships.

### Track 4 — Sealed builds and capacity you can read

| # | Work | Proof |
|---|---|---|
| 4.1 | **System → Capacity**: queue median wait per channel, box memory and CPU headroom, monthly tokens per tenant and the share that is routine, drop-off at "add your engine" | The numbers exist before any of them is needed |
| 4.2 | **A container per build** inside the tenant's unit (the agent CLIs in the image, the tenant's home mounted, per-build CPU/memory/network limits); `SandboxExecutor` is the seed | A tricked agent in one build cannot read its tenant's other projects |
| 4.2b | **gVisor** (`runsc`) as the container runtime where the box allows it: a user-space kernel between the agent and the host, no KVM needed | The deploy checks for `runsc` and the unit says which runtime it got |
| 4.3 | **A microVM per build** where the hardware exposes KVM (a dedicated box; the CX43 does not); rented VMs per build at roughly one to two rappen each as overflow | A build runs in a VM that did not exist a minute before and does not exist a minute after |
| 4.4 | **One box becomes a pool** when the readings say so: a second box's units claim from the same queue; the deploy reconciler targets the right box | Two boxes, one queue |

**Cost:** 4.1, 4.2 and 4.2b are CHF 0 on the existing box. 4.3 and 4.4 are
the first money this plan spends, and only when 4.1 shows a wall: a CX53
(about CHF 35 a month), a dedicated box with KVM, or rented VMs per build. **Records:** the
numbers themselves are the record; the roadmap's "Capacity you can read"
and "Sealed builds" move to Now one at a time.

## 5. What this looks like at scale

The owner's test for every design: what does it look like at 100,000 users?

| Users | Where builds run | What Loki pays | What changes |
|---|---|---|---|
| 10 | One box, one Linux user each, a container per build | CHF 17 a month | Tracks 1 and 4 |
| 100 | Two or three boxes in a pool | A box per ~40 active tenants | 4.4 |
| 1,000 | A pool plus rented VMs per build on demand | Box time only; engines are theirs | 4.3–4.4 |
| 100,000 | A scheduler over rented capacity; the box is the control plane | Capacity per minute of building, passed through in the plan price | Nothing in the rule changes |

The economics hold at every row for one reason: **the engine is never
Loki's** except inside the bounded allowance a plan buys wholesale. Loki's
marginal cost per tenant is a Linux user and a few database rows; per build,
a few minutes of a machine. That is the same reason OrangeCat's Cat runs on
free / supporter / your own key / credits, and why the July plan's "BYO
keys = BYO cost = clean unit economics" was right even though its mechanism
was not.

## 6. What we deliberately do not do

- **No second box, no larger box, no rented VM** before System → Capacity
  shows a queue. CHF 0 is a feature of the plan, not a constraint on it.
- **No card rail.** Stripe is gone and stays gone; a franc arrives by hand
  until the company can receive Bitcoin in its own name.
- **No "bitbaum" org that builders join.** Org peering means dispatch on
  every peer's projects. A builder is a seat on one project.
- **No sharing of any sign-in.** One Claude login serving many people would
  break the vendors' terms and the rule. The design makes it impossible by
  construction: a sign-in lives in one tenant's home.
- **No per-plan model gating, no "unlimited" tier.** Every plan sees every
  model; a stronger one is a key away. Every allowance is a number.
- **No isolation that costs money before the isolation that is free.**
  Linux users and containers on the existing box first; a bigger box, a
  box with KVM or rented VMs only when System → Capacity shows a queue.
- **No marketing spend** before a tenant who is not the owner builds on their
  own engine. The product has to be true before it is told.
- **No role names chosen now.** Three rounds of names were rejected; the
  right ones come with the screens in 3.4.

## 7. Gates (amending `sustainability-gates.md`)

**Gate 1 is split.** It said "hosted execution stays founder-only until
metering exists". Its reason was Loki-paid compute under a flat plan. So:

- Hosted execution **on the person's own engine** (subscription or key, in
  their private builder) is allowed from Track 1. Loki pays nothing per
  build, so the gate's reason does not apply.
- Hosted execution **on Loki's key** stays gated on metering (1.6) and a cap
  in CHF (2.1) — welcome changes and plan allowances both. The gate is shut
  until both exist and the numbers are on the System page.

Gate 2 (per-user chat cap, 2.4) and Gate 3 (per-seat Team billing, before the
first multi-seat Team sale) stand as written.

## 8. Risks

- **Memory on the box.** Six to ten concurrent sessions; `MemoryMax` per
  unit keeps one tenant from taking the box down; the symptom of growth is
  a queue, read on System, never a crash.
- **CLI sign-in in a headless home.** The device flow the owner used works
  from the web terminal; `claude setup-token` on a laptop with the token in
  the unit env is the fallback.
- **Welcome changes abused.** A spending cap at the vendor is the hard
  floor; the site-wide CHF cap stops the counter; new accounts are
  rate-limited already. Worst case is the cap, by construction.
- **The first customer leaves.** Manu with his own engine is the test. If
  the friction of a key or a sign-in loses him, welcome changes (2.1) are
  the answer, not a return to the owner's subscription.
- **The company is not registered when 2.3 arrives.** Then the first franc is
  a hand grant with a note and the legal name waits; nothing in the product
  blocks on it.
- **Vendor terms change.** A subscription inside one's own builder is the
  vendors' intended use today; if that changes, the key path and the plan
  path remain.

## 9. Decisions

The owner's direction on 2026-10-20: build the end game now, as well as it
can be built, so it works for as many people as possible. That settles 1,
2 and 4 below. The numbers in 5 and 6 are applied as written until the
owner changes them; each is one constant in `src/config`, named here, and
each shows on the System page beside what it cost.

| # | Decision | Standing answer |
|---|---|---|
| 1 | The rule — whoever asks pays, with their own engine, in their own builder — and therefore retire the per-site allowance | Yes (2026-10-20) |
| 2 | The first customer is a studio-site owner (Manu on Petvity), building on his own engine, as the acceptance test of Track 1 | Yes (2026-10-20) |
| 3 | Money until the company exists: passes granted by hand after a payment received any way the owner accepts, noted on the grant; Bitcoin rail on when the company can receive | Yes, nothing in the product blocks on the company |
| 4 | One build in merge order (§3), not phases | Yes (2026-10-20) |
| 5 | Welcome changes: how many per new account, and the monthly cap in CHF | 3 builds per account; CHF 20 a month site-wide, funded at the vendor with its own cap; `src/config/welcome-changes.ts` |
| 6 | Builds inside a plan: Personal / Pro / Team per month | 10 / 40 / 100 with a per-build token ceiling, in `PLAN_LIMITS.buildsMonthly`, re-read against real cost per build after two weeks of readings |

## 10. Ninety days from a yes

| Metric | Now | Day 90 |
|---|---|---|
| Accounts building in their own tenant on their own engine | 0 | ≥ 3 (Manu, one partner, one stranger) |
| Builds sealed in their own container | 0 | all of them |
| Builds on the owner's subscription that are not the owner's | some, uncounted | 0, by construction |
| Credentials in an agent's environment | DB password, org token, owner's sign-in | none but its own |
| Revenue ever | CHF 0 | ≥ 1 pass with an amount |
| Welcome spend | — | ≤ the cap, visible beside revenue |
| Hosting | CHF 17 | CHF 17 |
| Capacity readings on System | none | queue wait, memory, tokens per tenant |

## Appendix — the July plan, item by item

| July item | What happened |
|---|---|
| Phase 0, verify the bridge loop | Done 2026-07-13 (`sprint-2026-07-13-prove-the-thesis.md`) |
| 1.1 onboarding to first dispatch | Partly; still lies for a fresh account (finding 3) → 0.2 and 2.5 here |
| 1.2 Stripe price IDs | Stripe removed in #508; prices decided 2026-10-17 in CHF; Bitcoin passes built and dark → 2.3 |
| 1.3 per-user agent tokens | Agent tokens shipped; per-user *runner* tokens are 1.3 here |
| 2.1 SandboxExecutor per tenant | Substrate exists; Linux users first (Track 1), then it wraps every build inside each tenant's unit (4.2) |
| 2.2 broaden box CLIs, per-user credentials | CLIs are on the box; per-user credentials are the whole of Track 1 |
| 2.3 metered hosted tier | → 1.6 (readings) and 2.2 (plans include builds) |
| 2.4 hosted runner as a no-runner fallback | Serves the owner only; replaced by welcome changes (2.1) in a private builder |
| 3.x trust hardening | B5, B6, D5 done; deploy rollback (D3) still open, unchanged priority |
| 4.x distribution | `gtm-distribution-2026-08.md`; no paid distribution before a second tenant builds (§6) |
| Decision 1, split Horizon E | Taken; this plan is the hosted half |
| Decision 2, prices | Taken 2026-10-17 |
| Decisions 4–5, Stripe and domain | Stripe moot; domain unchanged and not blocking |
