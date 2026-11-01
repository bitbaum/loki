# AccountKit migration staging

Loki still signs in through Auth.js (`src/auth.ts`). Migration
`drizzle/0130_accountkit_staging.sql` adds AccountKit's tables beside it
under the `auth_` prefix (`createAuthTables("auth_")` in
`src/db/schema/accountkit.ts`), because Auth.js already owns `users`,
`accounts` and `sessions`. Nothing reads or writes them yet. The fleet's
acceptance queue is
[Fleet's checkpoint](https://github.com/bitbaum/fleet/blob/main/docs/remediation-resume-2026-10-29.md).

## Rehearse the import

Against an isolated database holding an authorised snapshot, after every
migration:

```sh
DATABASE_URL=postgres://… pnpm run db:rehearse-import
```

It runs `scripts/db/accountkit-import.sql` in one transaction, always rolls
back, and prints only counts. There is no apply mode. It takes locks even
though it rolls back, so never point it at the served database.

What the import carries:

- Each `users.id` stays the shared user id, so projects, orgs, runs and
  conversations keep pointing at the same person.
- Password hashes are copied as they are. Loki's scrypt `hex.salt` is read
  through AccountKit's `legacyPassword` (0.17.0), and Loki's own writers keep
  writing it.
- A linked OrangeCat actor becomes an `orangecat` account row.
- A person with no address (an X sign-in) gets a `loki-<id>@users.invalid`
  placeholder that AccountKit needs and Loki never shows.
- GitHub, Google and X links stay in Auth.js's `accounts`, where the GitHub
  features read their tokens.

Address collisions once lower-cased, drift between runs, or an already-used
shared runtime fail the transaction.

The import finally attaches three mirror triggers defined in migration 0130:

- `users` → `auth_users`: every Loki writer of `users` (sign-up, invites,
  setup, the reset link, the password routes, admin edits, deletion) keeps the
  shared row and the credential in step. A password change ends every other
  shared session. `/api/me/password` names its own session in
  `loki.keep_session`, so the person changing it stays signed in.
- `auth_users` → `users`: a verification, or a real address change, made by
  AccountKit.
- `auth_accounts` → `accounts`: an OrangeCat sign-in through AccountKit stores
  its token set where publish, promote and the wallet read it. A refresh token
  is replaced, never blanked.

## Shared runtime (built, off)

With `AUTH_RUNTIME=accountkit` the runtime in `src/lib/auth/shared/` answers
every sign-in; unset, Auth.js answers as today. The secret is
`BETTER_AUTH_SECRET`, or the `AUTH_SECRET` the box already holds.

- `auth()` keeps today's session shape. It is read from the shared session and
  the `users` row on every request, so a rename, a finished onboarding or a
  reseeded account applies on the next request.
- The proxy reads the shared session and asks the same `authorized()`
  callback (`src/auth.config.ts`).
- The pages keep `next-auth/react`. AccountKit's compat layer
  (`@bitbaum/accountkit/auth/nextauth-compat`, configured in
  `src/lib/auth/shared/compat.ts`) answers its calls from the shared runtime:
  - `session` (GET and POST), `csrf`, `providers` and `signout`;
  - the three credentials flows: `email-password`, the invite's
    `user-password`, and the owner key against the stored hash;
  - `signin/orangecat`, which signs in, or links for a signed-in person. The
    studio's server-side `signIn("orangecat")` arrives at the same place by
    redirect.
- Every sign-in runs `src/lib/auth/bootstrap.ts` (onboarding heal, personal
  org), the same code the Auth.js event now calls.
- A person AccountKit creates itself (a first OrangeCat sign-in) gets a Loki
  row under the same id, without a placeholder address.
- Of AccountKit's own endpoints only the session, sign-in, sign-out and the
  OAuth callback are open. Its sign-up, reset and password endpoints stay
  closed until Loki adopts its screens, so there is no second credential
  writer.

`scripts/test/accountkit-journeys.ts` (part of `pnpm run test:db`, which CI
runs on a fresh Postgres) runs all of this through the real handlers and the
real import, then the rehearsal. That is not deployed evidence.

## Not offered on this runtime, and why that blocks the switch

AccountKit reaches Google, GitHub and X only through the shared bitbaum
sign-in (`SIGNIN_*`). That service is live but has no provider credentials
yet. On this runtime their buttons hide (`getEnabledAuthProviders`), so:

- A person whose only way in is GitHub, Google or X, with no password and no
  OrangeCat link, cannot sign in until the broker carries that provider or
  they set a password first.
- GitHub sign-in also granted the `repo` and `workflow` scopes that the
  "Start a new project" flow uses. On this runtime that token has to come from
  a separate "Connect GitHub" step, which does not exist yet.
- An `ENABLE_OWNER_KEY` install that relies only on `LOCAL_AUTH_PASSWORD` (no
  stored hash) stays on Auth.js.

## Before switching

1. **OrangeCat callback.** Done: client `loki` accepts
   `/api/auth/oauth2/callback/orangecat` (orangecat#1508, live).
2. **Social sign-in.** Either the bitbaum sign-in carries GitHub and Google
   (owner: provider credentials), or the people who sign in only that way are
   counted and asked to set a password first. A "Connect GitHub" step for the
   repository token is also needed.
3. Stop Loki's credential writes, import once under locks, then set
   `AUTH_RUNTIME=accountkit`. Everyone signed in under Auth.js signs in again
   once. To roll back, unset `AUTH_RUNTIME` and drop the three triggers.
   Hashes stay in Loki's format in `users.password_hash`, so nothing needs a
   reset.
4. Prove the following on the deployed artifact with an approved test identity:
   - sign-in;
   - recovery;
   - an invite;
   - an OrangeCat sign-in followed by a publish;
   - revocation.
