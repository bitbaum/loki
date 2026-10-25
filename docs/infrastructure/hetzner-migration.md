# Exit Vercel/Supabase/Neon — everything on the Hetzner box

2026-06-12: full exit completed. Trigger was the Vercel team block (all prods
402 DEPLOYMENT_DISABLED); decision extended to leaving hosted Supabase and
Neon entirely. Every real app and every database now lives on the `bitbaum`
box. Hosted accounts are kept frozen for 14 days as a fallback, then deleted
(see Decommission below).

## Box layout (bitbaum · 167.233.22.31 · CX33 4 vCPU / 8 GB · 80 GB disk + 4 GB swap)

> **Current spec, measured 2026-09-04:** `nproc` = 4, `free -m` = 7746 MiB,
> `df -h /` = 75 G, swap 4095 MiB. That is a **CX33**, and it is what
> `src/app/api/system/hetzner/route.ts` has said all along ("the box is a cx33
> and cannot simply be resized: Falkenstein is capacity-blocked"). This heading
> claimed CX43 / 8 vCPU / 16 GB / 40 GB — every figure but the swap was wrong,
> in the direction that matters: planning against 16 GB on an 8 GB machine is
> how you meet the OOM killer.
>
> Note the shape of the drift. CPU and RAM went DOWN (8→4, 16→8) while the disk
> went UP (40→75), which is what a disk-inclusive rescale to a smaller tier
> looks like — a trade made to escape the disk-full problem the caveat below
> describes. The caveat is kept as the historical record of how that arose.
>
> **Do not re-state these numbers elsewhere.** `/api/system/hetzner` reports
> them live; a hardcoded spec is a second source of truth that rots silently,
> which is exactly what happened here between June and September.

> **Disk caveat (HISTORICAL, 2026-06-30 — superseded by the measurement above):**
> the CPU/RAM were rescaled to CX43 (8 vCPU / 16 GB)
> ~2026-06-16, but the rescale was done **"Nur CPU und RAM"** (CPU & RAM only), so
> the disk is still stuck at the original **40 GB** (`df` shows 38 GB, ~85–92% full).
> The full CX43 tier ships ~160 GB. To claim it requires a **disk-inclusive rescale**
> (power off → Rescaling → the *irreversible* option), then `growpart /dev/sda 1 &&
> resize2fs /dev/sda1` inside the box. As of 2026-06-30 a disk-inclusive rescale was
> blocked by **limited Cloud-instance availability at Falkenstein** (Hetzner status
> banner since 2026-06-26) — a detachable **Volume** is the capacity-independent
> alternative. We only have **SSH** to the box, no Hetzner Console/API access.

The table below is the stack as migrated. The current app list (ports, hosts,
repos, databases — including later additions such as solon, substrata, heidi)
is `scripts/hetzner/apps.conf`; read that, not this table. The old hosts
revampit.orangecat.ch and aoz-wohnen.orangecat.ch are 308 redirects to the
hosts shown.

| Service                  | Port | Domain                          | DB                    |
|--------------------------|------|---------------------------------|-----------------------|
| loki-bridge        | 4001 | bridge.orangecat.ch             | —                     |
| loki-app           | 4002 | loki.orangecat.ch         | loki (PG17)     |
| orangecat-app            | 4003 | orangecat.ch, www               | self-hosted Supabase  |
| evig-app                 | 4004 | evig.orangecat.ch               | revampit (PG17)       |
| kivvi-app                | 4005 | kivvi.orangecat.ch              | kivvi                 |
| datacat-web-app          | 4006 | datacat.orangecat.ch            | datacat               |
| aoz-wohnen-app           | 4008 | aoz.orangecat.ch                | aoz_wohnen            |
| surf-your-life-app       | 4009 | surf-your-life.orangecat.ch     | surf_your_life        |
| vitareba-app             | 4011 | vita.orangecat.ch               | vitareba              |
| revamp-info-app          | 4012 | revamp-info.orangecat.ch        | revampit (shared)     |
| petvity-app              | 4013 | petvity.orangecat.ch            | petvity               |
| botsmann-app             | 4014 | botsmann.orangecat.ch (*)       | self-hosted Supabase  |
| printcraft-app           | 4015 | printcraft.orangecat.ch         | Supabase, `printcraft` schema |
| sbb-fundbuero-app        | 4016 | sbbfundbuero.orangecat.ch       | — (demo frontend)     |
| reparaturbonus-zh-app    | 4017 | reparaturbonus.orangecat.ch     | reparaturbonus        |
| Supabase stack (docker)  | 8000 | supabase.orangecat.ch           | own PG15 container    |
| Postgres 17 (host)       | 5432 | —                               | all app DBs           |
| redis-server             | 6379 | —                               | (idle, installed for datacat backend if ever needed) |
| Caddy (auto-TLS)         | 443  | all of the above                |                       |

(*) botsmann.com has NO nameservers (domain lapsed?) — restore the domain at
the registrar, then add `botsmann.com, www.botsmann.com` back to apps.conf
and an A record wherever its DNS lands.

## SSOT tooling — scripts/hetzner/

- `apps.conf` — the manifest (name|port|domains|repo|app_dir|db). Single
  source of truth for ports, domains, repos, DBs.
- `sync-infra.sh [app…]` — generates launch.sh + systemd unit + Caddy vhost
  (in /etc/caddy/apps.d/*.caddy) from the manifest. Idempotent.
- `gen-env.sh <app>` — builds `<repo>/<app_dir>/.env.selfhost.local` from the
  captured per-app env backup (`$ENV_BACKUP_DIR`, default ~/dev/env-backup),
  strips host-runner vars, rewrites DB URL to the box role, points
  AUTH_URL/site URLs at the new domain, adds AUTH_TRUST_HOST.
- `deploy.sh <app> [--env]` — builds (standalone, env sourced, build-time DB
  over an SSH tunnel on 127.0.0.1:15432), stages static+public, rsyncs to
  /opt/<app>/app, restarts, health-checks. `--env` force-uploads the env file
  (box .env is otherwise never overwritten).
- `verify.sh` — fleet-wide systemd + local + public-HTTPS sweep.

The four pre-existing services (bridge, loki, orangecat, revampit) keep
their handcrafted units and Caddyfile blocks; revampit push-deploy is wired
via `.husky/pre-push` + `scripts/selfhost-deploy-revampit.sh` (also in
`install-push-deploy.sh revampit`).

## Databases

- Host Postgres 17: one role per app (passwords in `~/.db-credentials` on the
  box, chmod 600). pg_hba is per-role allowlisted — new app rules MUST be
  inserted BEFORE the `reject` block (first match wins).
- pgvector installed (revampit + surf_your_life use it).
- revampit and revamp-info share the `revampit` DB (was one shared Neon DB).
- Nightly dumps: /etc/cron.daily/pg-backup → /opt/backups/nightly/<date>/,
  14-day retention. Initial migration dumps in /opt/backups/initial/.

## Self-hosted Supabase (orangecat + botsmann + printcraft)

- /opt/supabase/docker — upstream supabase/docker compose, pinned PG 15.8.
  Running services: db, kong (127.0.0.1:8000), auth, rest, storage, imgproxy,
  meta, studio. NOT running: realtime (orangecat polls; start it after a box
  upgrade if push updates are wanted), functions, supavisor, logs stack.
- Secrets in /opt/supabase/docker/.env. Fresh JWT secret (hosted project's
  secret was never recoverable) → sessions died at cutover, bcrypt password
  hashes survived. ANON/SERVICE keys are HS256 JWTs minted from the secret.
- IMPORTANT: apps must use the **JWT** anon/service keys, not the
  `sb_publishable_*`/`sb_secret_*` strings — Kong accepts both as apikey, but
  PostgREST needs a real JWT in Authorization. App envs set *_PUBLISHABLE_KEY
  to the anon JWT for compatibility with code that prefers it.
- GoTrue: ENABLE_EMAIL_AUTOCONFIRM=true because no SMTP is configured yet.
  Password-reset emails will NOT send until SMTP_* is set in the stack .env
  (then disable autoconfirm).
- printcraft lives in its own `printcraft` schema (its table names collide
  with orangecat's). PGRST_DB_SCHEMAS includes it; its supabase-js clients
  pass `db: { schema: 'printcraft' }`. Storage buckets are shared by bucket id
  (orangecat: avatars/banners/documents/project-media/proofs; printcraft:
  project-files).
- All 25 orangecat + 10 printcraft storage objects migrated; stored URLs in
  the DB rewritten from ohkueislstxomdjavyhs.supabase.co →
  supabase.orangecat.ch.

## App-level changes made for self-hosting

- Drizzle apps swapped `@neondatabase/serverless`/neon-http → `pg` +
  `drizzle-orm/node-postgres` (+ `serverExternalPackages: ["pg"]`).
- aoz-begleitung: Prisma Neon adapter removed (plain PrismaClient).
- kivvi already had a postgres-js fallback; `DB_SSL=disable` env opts out of
  its hardcoded prod-SSL.
- surf-your-life (bitbaum/surf-your-life): `lib/domain/auth.ts` split (db-using verifyEmailToken →
  `lib/domain/verify-email.ts`) so client components stop pulling pg.
- vitareba/petvity: `@vercel/blob` → `lib/storage.ts` local-disk helper
  (UPLOADS_DIR=/opt/<app>/uploads, Caddy serves /uploads/*). Vercel Blob was
  never actually configured in prod — there were zero blobs to migrate.
- revampit: already had a local-fs upload fallback; public/uploads is now a
  symlink to /opt/revampit/uploads so deploys can't wipe it.
- orangecat: Supabase URL validator relaxed (any https), new image
  remotePattern for supabase.orangecat.ch, env carries PORT/HOSTNAME/NODE_ENV
  (don't drop them when regenerating!).
- botsmann: CSP connect-src includes supabase.orangecat.ch.

## DNS (Infomaniak, orangecat.ch zone)

A records → 167.233.22.31: @, www (CNAME), bridge, loki, revampit,
supabase, kivvi, datacat, aoz-wohnen, surf-your-life, vitareba,
revamp-info, petvity, printcraft, sbb, reparaturbonus. Caddy issues certs on
first resolvable request.

## Known gaps / loose ends

- **formular-erfassung**: Vercel project exists but no local repo and no
  linked GitHub repo — source location unknown, not migrated.
- **botsmann.com** domain has no NS records (lapsed?). App serves on
  botsmann.orangecat.ch meanwhile. botsmann's MongoDB Atlas dependency is
  retired per owner — Mongo-backed features are dead code.
- **sbb-fundbuero**: only the demo frontend is deployed (its backend
  services were never deployed anywhere, incl. on Vercel).
- **swiss-longevity-hub / slh.orangecat.ch**: retired 2026-06-28 — product
  renamed to surf-your-life; DB dropped, removed from `apps.conf`.
- **datacat**: deployed as full-stack Next app; the express `backend/` dir is
  local-dev legacy.
- **SMTP**: GoTrue + Auth.js reset-mail flows need an SMTP/Resend decision.
- Ops scripts in revamp-info (audit-themes, set-confidence) still import the
  Neon driver — convert to pg before running them again.
- Box is now CX43 (8 vCPU / 16 GB, €17.29/mo) — CPU/RAM rescale completed
  ~2026-06-16. ⚠️ **The "Nur CPU und RAM" advice below was a mistake**: it keeps
  the disk frozen at the old 40 GB while charging for the bigger tier. For a
  permanent always-on box we never downsize, so the disk-inclusive (irreversible)
  rescale is what we actually want — it brings the disk to ~160 GB. Blocked as of
  2026-06-30 by limited Falkenstein capacity; a Volume is the fallback. After any
  disk grow: `growpart /dev/sda 1 && resize2fs /dev/sda1`. Hetzner automatic
  backups should also be enabled (console → Backups → Aktivieren).

## Decommission (after 2026-06-26 if stable)

1. Delete Neon projects (ep-wild-firefly, ep-holy-truth, ep-restless-dream,
   ep-young-meadow, ep-frosty-mode).
2. Delete/pause Supabase projects ohkueislstxomdjavyhs + ckpynkpsfnuqndplaapc.
3. Delete the Vercel projects / let the blocked team rot. loki.vercel.app
   etc. are gone regardless (Vercel-owned names).
4. Final dumps live in /opt/backups/initial/ + /opt/backups/supabase/ — keep.

## Push-to-deploy (added 2026-06-12, evening)

`git push` on main deploys — the Vercel UX, self-hosted. A pre-push hook
(installed by `scripts/hetzner/install-push-deploy.sh`, idempotent, all
manifest repos + loki) backgrounds the standalone build + rsync +
restart; logs in /tmp/push-deploy-<app>.log. The deploy builds the working
tree being pushed from. Husky repos get the block in .husky/pre-push,
plain repos in .git/hooks/pre-push.


## Shared package release receipts

The shared self-host workflow establishes repository visibility and fetches
Fleet's receipt producer. `scripts/hetzner/deploy.sh` then calls
`scripts/hetzner/stage-release-receipt.sh` after assembling standalone/static/public
output and before rsync. The receipt lives beside the actual staged server at
`public/.well-known/fleet-release.json`, including nested standalone projects.

Fleet owns artifact parsing and the receipt contract:
[release-receipt.mjs](https://github.com/bitbaum/fleet/blob/main/scripts/ci/release-receipt.mjs).
The producer checks the clean checkout, exact commit, locked artifacts and
installed versions. Public receipts contain only first-party package metadata;
private or unknown repository visibility omits the public file. Missing or
failed generation removes stale staged receipts and reports that promotion has
no proof. Existing application health/rollback behavior remains authoritative for
shipping; a configured Fleet receipt gate separately holds package promotion
until the live receipt matches its expected source and locks.

`FLEET_RECEIPT_PUBLIC`, `FLEET_RECEIPT_ROOT` and `FLEET_RECEIPT_REPO` are deployment
caller inputs, captured before runtime app environment is loaded. Local/manual
deploys without established public scope publish no receipt. Validation uses
`test-stage-release-receipt.sh` in the existing `test:ops` bundle.
