# **TITLE**

Beta — running, not released.

## Run it

```bash
pnpm install
cp .env.example .env.local   # fill in DATABASE_URL at least
pnpm run db:migrate          # create the tables
pnpm dev                     # http://localhost:3000
```

`pnpm run verify` is the definition of done: format, lint, typecheck, unit
tests and a production build. `pnpm run test:integration` drives sign-up and
sign-in against a real Postgres (`DATABASE_URL` must name a `*_test` database —
the suite recreates its schema).

## What is already here

- **Accounts** — email and password (with email confirmation when mail is
  configured), a sign-in link by email, passkeys, two-factor codes, and "Continue
  with" buttons for the shared bitbaum sign-in and for OrangeCat, each shown
  only when configured. Roles: customer, helper, professional, staff, admin.
- **Three languages** — English, German and French under `/en`, `/de`, `/fr`.
- **Security** — a nonce-based Content-Security-Policy, HSTS, no framing, no
  referrer, camera/microphone/location/payment switched off; rate limits on
  every sign-in path; provider tokens never stored; secrets sealed at rest.
- **A model** — `POST /api/ai` through `@bitbaum/ai-kit`, on the shared free
  chain or the person's own key (Account → Your own model).
- **`/api/health`** — green only when the database answers and accounts work.
- **Roadmap and changelog** at `/roadmap` and `/changelog`, from `ROADMAP.md`
  and `CHANGELOG.md` via Loki's fleet map.

The environment the app reads is documented in [`.env.example`](.env.example).

## Deploy

Push to `main` deploys through Loki's shared self-host workflow
(`.github/workflows/deploy.yml` — the only file that knows about our
infrastructure). After each deploy, `live-check.yml` checks the live site from
outside.

Made from `bitbaum/fleet` `templates/app`. MIT licensed.

### Shared building blocks

Review `package-plan.json` before adding a feature. The root layout composes
sitekit chrome, accountkit owns account behavior and screens, and bip-kit renders
the journal plus roadmap/changelog. Chat surfaces use chatkit's shared composer
and thread through `components/chat/SharedChat.tsx`. Publish real journal entries as reviewed
Markdown in `content/blog`; drafts stay excluded by bip-kit. Empty records say
they are empty. Shared package composition CI checks actual adoption and the
release-to-dependency-update-to-deployment path.
