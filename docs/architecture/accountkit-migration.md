# AccountKit migration

Loki signs in through AccountKit since 2026-11-01 (`AUTH_RUNTIME=accountkit`).
Auth.js (`src/auth.ts`) stays in the tree for a rollback. Migration
`drizzle/0130_accountkit_staging.sql` adds AccountKit's tables beside it
under the `auth_` prefix (`createAuthTables("auth_")` in
`src/db/schema/accountkit.ts`), because Auth.js already owns `users`,
`accounts` and `sessions`. The fleet's
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

The import finally attaches two mirror triggers defined in migration 0130:

- `users` → `auth_users`: every Loki writer of `users` (sign-up, invites,
  setup, the reset link, the password routes, admin edits, deletion) keeps the
  shared row and the credential in step. A password change ends every other
  shared session. `/api/me/password` names its own session in
  `loki.keep_session`, so the person changing it stays signed in.
- `auth_users` → `users`: a verification, or a real address change, made by
  AccountKit.

AccountKit stores no provider token. A first OrangeCat sign-in hands OrangeCat's
token set to `onAccountCreated` (`src/lib/auth/shared/accounts.ts`), which keeps
it in Loki's `accounts`, where publish, promote and the wallet read it. A refresh
token is replaced, never blanked. Migration 0131 dropped the trigger that was
meant to copy them out of `auth_accounts`, where they never arrive.

## Shared runtime (on since 2026-11-01)

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

## Not offered on this runtime

AccountKit reaches Google, GitHub and X only through the shared bitbaum
sign-in (`SIGNIN_*`). That service is live but has no provider credentials
yet. Once `SIGNIN_ISSUER`, `SIGNIN_CLIENT_ID` and `SIGNIN_CLIENT_SECRET` are
set, AccountKit mounts it as `bitbaum-signin`, and the sign-in and sign-up
pages show "Continue with Google, Apple, GitHub, X or Facebook"
(`getEnabledAuthProviders().signin`). The compat layer starts it like
OrangeCat. The deploy then expects it in `/api/auth/providers`
(`scripts/expected-auth-providers.ts` reads the box's OIDC env). Until
then, the separate GitHub, Google and X buttons stay hidden on this runtime,
so:

- A person whose only way in is GitHub, Google or X, with no password and no
  OrangeCat link, cannot sign in until the broker carries that provider or
  they set a password first.
- GitHub sign-in also granted the `repo` and `workflow` scopes that the
  "Start a new project" flow uses. On this runtime that token has to come from
  a separate "Connect GitHub" step, which does not exist yet.
- An `ENABLE_OWNER_KEY` install that relies only on `LOCAL_AUTH_PASSWORD` (no
  stored hash) stays on Auth.js.

## Switching (and back)

`.github/workflows/accountkit-switch.yml` (`scripts/hetzner/accountkit-switch.sh`)
moves one product at a time — kivvi, petvity, surf-your-life, evig or loki — on
the box. `survey` counts only, including the people who would be locked out.
`switch` refuses while that count is above zero; otherwise it imports under
locks, sets `AUTH_RUNTIME=accountkit`, restarts and proves sign-in on the public
site with a throwaway account, rolling back on any failure. `rollback` returns
the product to Auth.js.

`prove` runs on a switched product the journeys a person relies on, on the
public site, with throwaway accounts it deletes again:

- two sessions at once;
- a change to the person's row, read on the next request;
- a password write ending every session, then the old password refused and
  the new one accepted;
- sign-out, and deletion ending the session;
- where the product offers OrangeCat, a real browser sign-in with a throwaway
  OrangeCat account (`scripts/hetzner/accountkit-oidc-proof.mjs`).

## Switched (2026-11-01)

The switch ran from `accountkit-switch.yml`:

1. A survey counted 15 accounts: 8 with a password and 8 with an OrangeCat
   link. Nobody's only way in was GitHub, the one social sign-in Loki offered:
   Google and X were already paused (`PAUSED_PROVIDERS`). So nobody was locked
   out.
2. The import ran once, under locks, and attached the mirror triggers.
3. `AUTH_RUNTIME=accountkit` was set and the app restarted.
4. A live proof ran on loki.orangecat.ch. A throwaway account signed in
   through `email-password`, read its session back, signed out, and was
   deleted.

The first switch was rolled back the same hour. OrangeCat sign-in answered
`unavailable`, because AccountKit 0.18.0 started it through an endpoint
better-auth 1.7 removed. AccountKit 0.18.1 (bitbaum/accountkit#55, #1511 here)
starts it through `/sign-in/social`, and the switch ran again. The sign-in
button now reaches OrangeCat's authorize page with the redirect
`/api/auth/callback/orangecat`, which client `loki` accepts.

Everyone signed in under Auth.js signs in again once. GitHub tokens already
stored in `accounts` stay where the GitHub features read them. A new GitHub
connection waits for the "Connect GitHub" step (above).

To roll back, run the workflow with `rollback`. Hashes stay in Loki's format
in `users.password_hash`, so nothing needs a reset.

Proven live on 2026-11-01 by `prove`, using throwaway accounts that it deleted
again:

- two sessions at once;
- a change to the person's row, read on the next request;
- a password write, which is what a reset does. It ended both sessions, the
  old password was refused and the new one signed in;
- sign-out, and deleting the person ending their session;
- a real browser OrangeCat sign-in: OrangeCat's sign-in and consent, and back
  into Loki, signed in.

That proof found two defects, fixed in AccountKit 0.19.0 and #1528 here:

- the first OrangeCat sign-in failed (`unable_to_create_user`);
- OrangeCat's tokens never reached Loki's `accounts`.

The invite flow (`user-password`) runs in `test:db` on every pull request.

Not proven by a machine:

- a reset mail arriving in a real inbox;
- a publish to OrangeCat with a token that a real sign-in stored.
