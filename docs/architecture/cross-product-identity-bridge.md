# Cross-Product Identity Bridge — "Login with OrangeCat" + Project/Changelog Sync

**Status:** Parts A steps 1–2 BUILT. OrangeCat's OIDC provider shipped 2026-06-17
(live at orangecat.ch: discovery/authorize/token/userinfo/jwks, PKCE, refresh rotation;
`loki` client registered with redirect
`https://loki.orangecat.ch/api/auth/callback/orangecat` and 7 scopes).
Loki relying party built 2026-07-02 (`orangecat` Auth.js OIDC provider,
`users.orangecatActorId`, sign-in button — gated on ORANGECAT_OAUTH_CLIENT_ID/SECRET env).
Part C BUILT 2026-07-02 (`b879625`, PR #55): per-project publish
(`src/lib/integrations/orangecat-publish.ts`, `user_projects.orangecatProjectId`,
`OrangeCatPublishButton`) + changelog→wall promote (policy SSOT
`src/config/orangecat-publish.ts`, wired into `appendDevLog`, sha256 dedupe ids,
per-user OIDC tokens with refresh rotation in `orangecat-identity.ts`).
Part B (FC side) STARTED 2026-07-02: OC→FC create deep link implemented —
`/projects?new=1&name=<prefill>` opens the create-project dialog on load
(prefilled name optional; query params survive the sign-in redirect via
`callbackUrl`, so unauthenticated OC users land in the dialog after signing in).
Remaining: Part B detect-and-suggest surfaces (OC-side "Build this with
Loki" link now has a target), settings "Connect OrangeCat" for existing
users, embeds, and a periodic promote backfill/reconcile job (promote is currently
fire-and-forget only).
**2026-09-29 (orangecat ADR-0009, step D7):** sign-up goes through OrangeCat.
The sign-up page's OrangeCat button opens OrangeCat's own create-account screen
(`prompt=create`, `src/lib/auth/orangecat-sign-in.ts`); the Loki password form
waits behind one line ("Prefer a password just for Loki?"). A signed-in person
whose account is not yet linked sees one calm banner with one click, "Connect
OrangeCat" (`components/shell/OrangeCatConnectBanner.tsx`), the same round-trip
Settings → Account offers. Loki sessions stay Loki's own; the OrangeCat link is
what OrangeCat governs, and a refused refresh already marks it broken.
**Last updated:** 2026-09-29 (was 2026-07-02)
**Scope:** Loki ↔ OrangeCat. Touches both repos.
**Companion spec:** `docs/architecture/PLATFORM_AND_COLLABORATION.md` (OrangeCat
repo — the platform/serving side: publish bus, embed routes, OIDC provider internals).

This is the spec for unifying identity across Loki (capability layer) and
OrangeCat (identity + economy + public-presence layer), and for syncing projects
and changelogs between them. It is grounded in the real schema/auth of both
codebases as of 2026-06-16.

> **Corrected spine (2026-06-16, both tabs aligned).** Four refinements supersede
> the first draft of this doc:
> 1. **Publish-bus, not shared event bus.** Loki keeps a *private* event spine;
>    a config-driven *promote* step pushes only publish-worthy events to OrangeCat's
>    `timeline_events` (which is OC's public publish bus, not a general FC event log).
> 2. **Async, best-effort, idempotent publish.** The promote step never blocks the
>    user action and never double-posts or silently vanishes — it is async +
>    idempotent (`dedupe_key`) + reconcilable (backfill).
> 3. **Map teams, don't migrate them.** Loki orgs/teams stay auth-critical and
>    Loki-owned; OrangeCat *maps* to them (FC members → OC actors via OIDC `sub`),
>    it does not absorb them.
> 4. **Embed OC widgets, don't share a UI package.** The stacks diverge (Auth.js/Next
>    vs Supabase/Next); OrangeCat *serves* embeddable widget routes that Loki
>    *mounts*, rather than shipping a shared npm component library.

---

## 0. The decision this encodes

- **OrangeCat is the identity SSOT** — the *person*, the wallet, the public profile.
- **Loki is a capability surface** on that identity — the *workshop* where work gets done.
- **Provisioning is lazy + consensual.** Internal plumbing may auto-create; user-facing
  accounts/projects are *suggested with one click*, never silently duplicated.
- **Loki emits, OrangeCat publishes.** Projects and changelogs originate in
  Loki (which holds the technical truth) and are *projected* onto OrangeCat
  (which holds the public/economic truth). Same seam as "verified-done → settlement."
- **Do NOT build profiles, walls, or messaging inside Loki.** Each is an OrangeCat call.

### Grounding (what exists today)

| Fact | Source |
|------|--------|
| Loki auth = Auth.js (GitHub/Google/X/credentials); `users` UUID PK, unique nullable `email`, unique `username`; public profile `/u/[username]` | `src/auth.ts`, `src/db/schema/users.ts`, `src/app/u/[username]/page.tsx` |
| Loki projects = `entities`(type=project, `gitUrl`) + `user_projects`(`dirPath` local folder, `gitUrl`, `agentPref`, `modelPref`, devLog) | `src/db/schema/entities.ts`, `src/db/schema/user-projects.ts` |
| Loki↔OC today = single service-account key (`ORANGECAT_API_KEY`), subscription mirror + context read. NO per-user link. | `src/lib/integrations/orangecat.ts`, `orangecat-context.ts` |
| Loki hosted at `loki.orangecat.ch` (subdomain of OrangeCat) | `src/config/brand.ts` |
| OrangeCat auth = Supabase/GoTrue (relying party only — **no authorization-server**); `profiles`(UUID=auth.users.id, unique `username`, non-unique nullable `email`), auto-created via `handle_new_user()` trigger | `src/app/auth/oauthProviders.ts`, `scripts/db/schema_dump.sql` |
| OrangeCat `actors`(user/group) lazy-created via `getOrCreateUserActor()`; every entity owned by an actor | `supabase/migrations/...create_actors_table.sql`, `src/services/actors/getOrCreateUserActor.ts` |
| OrangeCat projects: `actor_id` owner, title/description, goal/currency, btc/lightning, `show_on_profile`, `status`. **No github/folder/external-id fields.** | `src/types/database.generated.ts`, `src/lib/validation/projects.ts` |
| OrangeCat `integration_keys` (actor-bound `ock_` keys, scoped) + `webhook_endpoints` + v1 API (`/api/v1`, `/api/projects`, `/api/stakeholders`) | `supabase/migrations/...integration_keys.sql`, `...webhook_endpoints.sql`, `src/app/api/v1/` |
| OrangeCat `stakeholder_relationships` with `customer` kind (Loki is OC's customer) | `supabase/migrations/...stakeholder_relationships.sql` |

### Key constraints that shape the design

- **Email is a weak join key.** OrangeCat `profiles.email` is **not unique**, and Loki
  X-login users have **no email**. So identity must be linked by a real OAuth subject, not email.
- **Both have a unique `username`** — usable as a *detection hint*, not the source of truth.
- **OrangeCat has no authorization-server today** — "Login with OrangeCat" is net-new there.
- **Same parent domain** (`*.orangecat.ch`) makes SSO and consent smoother.

---

## Part A — "Login with OrangeCat" (the keystone)

Yes it is possible; it is exactly how "Login with Google" works, except **OrangeCat must
become the OAuth2/OIDC _provider_** (it is currently only a _consumer_).

### Option 1 — OrangeCat as an OIDC provider (RECOMMENDED endgame)

Standard, decoupled, and reusable by every future product (hirn.li, etc.). OrangeCat builds a
small authorization-server layer; Loki adds one provider config.

**OrangeCat builds (net-new):**

- `GET /.well-known/openid-configuration` — discovery document.
- `GET /oauth/authorize` — checks the user's existing Supabase session (logging them in if
  needed), shows a **consent screen**, issues a short-lived authorization code (PKCE required).
- `POST /oauth/token` — exchanges code (+ PKCE verifier) → `access_token` + signed `id_token`.
- `GET /oauth/userinfo` — returns `sub` = the user's **actor_id** (stable identity), plus
  `preferred_username`, `email` (if present), `name`, `picture`.
- `GET /oauth/jwks.json` — public keys for verifying the `id_token`.
- New tables: `oauth_clients` (client_id/secret, redirect_uris, allowed scopes) and
  `oauth_auth_codes` (short-lived codes). Reuse the existing `integration_keys` revocation pattern.
- **Scopes:** `openid profile email` *plus* OrangeCat-specific capability scopes
  (`projects.write`, `wallet.read`, …). This is the elegant part — see "One consent" below.

**Loki builds (relying party — small):**

- Add a custom OIDC provider to Auth.js pointing at OrangeCat's endpoints, with a registered
  `client_id`/`client_secret`. Auth.js supports generic OIDC providers directly.
- On callback: store `orangecatActorId` (= `id_token.sub`) on the Loki `users` row.
- Surface it two ways:
  - **"Sign in with OrangeCat"** on the login page (new users).
  - **"Connect OrangeCat"** in settings (existing Loki users link their actor).

**One consent, both identity AND capability.** Because the authorize step can grant
`projects.write` / `wallet.read`, the same login that proves *who the user is* also returns a
token (or mints an actor-bound `integration_key`) that lets Loki create OrangeCat projects
and read the user's wallet on their behalf. No separate "now also connect your API key" step.

### Option 2 — Shared-domain session cookie (interim shortcut only)

Because Loki is `loki.orangecat.ch`, a cookie scoped to `.orangecat.ch` could be
shared. Faster to ship, but tightly coupled, fragile across auth stacks (Auth.js JWT vs Supabase),
and does not generalize to other products. **Use only as a stopgap if Option 1 is delayed.**
The endgame is Option 1.

### Security checklist (Option 1)

PKCE on the auth-code flow · `state` / nonce · rotating signing keys + JWKS · least-scope consent ·
token + key revocation (reuse `integration_keys.revoked_at` pattern) · short-lived codes ·
exact redirect-uri matching.

---

## Part B — Provisioning rules (auto vs. suggest)

| Thing | Policy | Why |
|-------|--------|-----|
| OrangeCat `actor` (internal) | **Auto** (already lazy via `getOrCreateUserActor`) | Internal plumbing, not a user-facing account |
| OrangeCat public **profile/account** | **Suggest + one click** | Consent, agency, email-collision risk |
| Loki account from OC | **Suggest, targeted at builders** | Most OC users are not builders; blanket = noise |
| Publishing a **project** to OC | **Opt-in, per project** | Private work → public+economic = irreversible act |

**Detect-then-offer (both directions):** match on OIDC `sub` if already linked; otherwise hint on
`username`, then `email` (never link silently on email alone). 
- *Loki signup* → after onboarding: match found → "Connect your OrangeCat profile"; no match
  → "Claim your public profile + wallet on OrangeCat" (prefilled from GitHub metadata).
- *OrangeCat signup* → only when a builder signal is present (owns a `project`, or connects GitHub):
  "Build this with an AI fleet → Loki."

**Implemented (FC side, 2026-07-02) — OC→FC create deep link.** OrangeCat links to
`https://loki.orangecat.ch/projects?new=1&name=<urlencoded prefill>`; the
projects page opens the create-project dialog on load, name prefilled. Params are
one-shot (stripped from the URL after opening so reload/back doesn't retrigger).
Unauthenticated users bounce through `/sign-in?callbackUrl=/projects?new=1&name=…`
("Continue with OrangeCat") and return with the params intact. Caveat: brand-new
users are gated through `/onboarding` first, which drops the callback — they land
on the app home, not the dialog, after onboarding.

---

## Part C — Project + changelog sync

### New Loki storage (the ONLY new Loki tables/columns in this whole plan)

- `users.orangecatActorId` (uuid, nullable) — the linked OrangeCat actor (= OIDC `sub`).
- `user_projects.orangecatProjectId` (uuid, nullable) — the published OrangeCat project, if any.

### Publish flow (opt-in, per project)

1. Loki holds the user's actor-bound capability (token or `ock_` key from Part A).
2. "Publish to OrangeCat" on a project → `POST {OC}/api/projects` with
   `{ title, description, website_url: <Loki public project URL>, bitcoin_address/lightning
   from the user's OC wallet }`.
3. Store the returned OrangeCat project id on `user_projects.orangecatProjectId`.
4. Optionally create a `stakeholder_relationships` edge.

### The mapping is intentionally lossy (this is correct, not a gap)

| Loki keeps (private build truth) | OrangeCat gets (public economic projection) |
|----------------------------------------|---------------------------------------------|
| `gitUrl` (repo), `dirPath` (local folder) | `website_url` = link back to Loki |
| `agentPref`, `modelPref`, devLog, health | title, description, funding goal, wallet |
| orchestration runs, CI, secrets | `show_on_profile`, status, contributions |

OrangeCat projects deliberately have **no** github/folder/external-id field. Loki owns the
technical record; OrangeCat owns the public listing; the cross-id joins them.

### Changelog → wall (publish bus, not a shared event log)

Loki keeps its **own private event spine** (release / `orchestration_runs` "shipped"
events live in Loki, full-fidelity). A **config-driven promote step** decides which
event types are publish-worthy and projects only those onto OrangeCat `timeline_events` —
OrangeCat's `timeline_events` is a **public publish bus**, *not* Loki's general event log.
Keep the two seams distinct: the private spine is the SSOT for what happened; the publish bus is
the curated public projection.

- **Promote policy is config, not per-call-site.** Which FC event types reach the wall lives in
  one place (`src/config/*`), not hardcoded at each emit. (OC mirrors this: its promote policy is
  also config-driven, per the OC-side companion doc.)
- **Async, best-effort, idempotent, reconcilable.** The promote never blocks the user action.
  Each promoted event carries a `dedupe_key` so a retry/race neither double-posts nor vanishes;
  a periodic backfill reconciles anything a transient failure dropped (same backfill pattern OC
  already runs for embeddings). "Best-effort" must *not* mean "silently lossy."
- Delivery: OC API now; `webhook_endpoints` for reverse delivery/confirmation.

This is the "building in public funds itself" loop: agents ship → curated changelog posts →
followers back it.

### Teams: map, don't migrate

Loki orgs/teams stay **Loki-owned and auth-critical** (they gate access to control,
projects, dispatch). OrangeCat does **not** absorb them into OC groups. Instead OC *maps* to them:
each FC org member resolves to an OC actor via the OIDC `sub`, so OC can attribute published
projects/changelogs to the right person without owning the team graph. This mapping is therefore
gated on the identity keystone (Part A) — same build-order dependency as everything else.

---

### Surfacing OC content in Loki: embed, don't rebuild, don't share a package

When Loki needs to *show* OrangeCat content (wallet balance, public profile, wall, funding
widget), the rule from §0 — "don't build social/wall/messaging in Loki" — resolves to
**embed an OrangeCat-served widget route**, not import a shared UI component and not re-implement it.

- **Why not a shared npm UI package:** the stacks diverge (Loki = Auth.js + its own design
  system; OrangeCat = Supabase + its own). A shared component lib couples two build pipelines and
  two token systems. Embedding keeps each product's UI owned by its own repo.
- **OrangeCat serves the embed; OrangeCat owns its security.** Per the OC-side companion doc, embed
  routes are protected with **origin-pinned `postMessage`** (only `loki.orangecat.ch`),
  **`frame-ancestors` CSP** on the embed routes, and a **short-lived scoped token** passed over
  `postMessage` — never the full session/cookie.
- Loki's job is just to mount the iframe/embed and hand it the scoped token from the Part A
  capability grant.

## Part D — Build order (do NOT reorder)

1. **OrangeCat OIDC provider** (Part A, Option 1) — authorize/token/userinfo/jwks/discovery +
   `oauth_clients`/`oauth_auth_codes` + consent screen. *Everything depends on this.*
2. **Loki relying party** — Auth.js OrangeCat provider + `users.orangecatActorId` +
   "Sign in / Connect OrangeCat" UI.
3. **Detect-and-suggest** both directions (Part B).
4. **Project publish** + `user_projects.orangecatProjectId` (Part C).
5. **Changelog → wall** (Part C).
6. **Polish:** optional same-domain SSO niceties, cross-funding, building-in-public surfaces.

## Non-goals

- No social/wall/messaging built inside Loki — all OrangeCat (embed its widget routes).
- No shared UI npm package between the two products — stacks diverge; embed instead.
- No Loki event log living on OrangeCat — FC keeps a private spine; only a config-driven,
  idempotent promote step reaches OC's publish bus.
- No OrangeCat ownership of Loki teams — OC maps to them via OIDC `sub`, never migrates them.
- No silent auto-creation of public accounts or published projects.
- No email-only identity matching.

## Gaps to close (from code)

- OrangeCat: build the authorization-server (none exists); decide whether to add an optional
  `source`/external-ref on projects (today the link rides on `website_url` + the Loki-side id).
- Loki: add the two columns; remember X-login users have no email → OIDC `sub` is the only
  reliable key (another reason Option 1 wins).
