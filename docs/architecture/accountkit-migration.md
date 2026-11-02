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
- A GitHub link also becomes a `github` account row, so GitHub signs the same
  person in. Its token, and Google and X links, stay in `accounts`, where the
  GitHub features read them.

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
- Every new session, whatever the way in, runs `src/lib/auth/bootstrap.ts`
  (onboarding heal, personal org), the same code the Auth.js event calls. A
  plugin in the runtime runs it (`src/lib/auth/shared/sign-in-hook.ts`), and
  it first gives a person AccountKit has but Loki does not (a sign-in link to
  a new address) their `users` row.
- A person AccountKit creates itself (a first OrangeCat sign-in) gets a Loki
  row under the same id, without a placeholder address.
- Of AccountKit's own endpoints, the session, sign-in, sign-out and OAuth
  callback are open. So are the ones Loki's screens reach directly
  (`src/lib/auth/shared/open-paths.ts`, routed in `src/auth.ts`):
  - passkeys: sign in with one, and add or remove one under Settings →
    Account;
  - the second factor: turn it on or off with the password, and give the code
    on the sign-in card right after the password;
  - the sign-in link, on sign-in and sign-up when account mail is configured.

  None of these writes a password. AccountKit's sign-up, reset, password,
  profile and deletion endpoints stay closed, so there is no second credential
  writer. Recovery stays Loki's own ("Forgot password?",
  `/api/auth/forgot-password`). Auth.js ignores passkeys and the second
  factor, so a rollback leaves people with their password and OrangeCat.

`scripts/test/accountkit-journeys.ts` (part of `pnpm run test:db`, which CI
runs on a fresh Postgres) runs all of this through the real handlers and the
real import, then the rehearsal. That is not deployed evidence.

## GitHub, Google and X on this runtime

GitHub signs in through Loki's own GitHub app, as it did on Auth.js:
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, at its existing callback
`/api/auth/callback/github` (AccountKit 0.22, `productGithubApp`). It is
opt-in since AccountKit 0.23 (`githubSignIn: true`), and the owner chose to keep
it on 2026-11-02.
`githubScopes` asks for `repo` and `workflow` beside the identity scopes, which
are what "Start a new project" and the repository features act with.

- A GitHub link made under Auth.js is recorded in AccountKit's table (the
  import, and migration 0134 on the switched box), so GitHub signs that
  person in as themselves.
- A signed-in person who presses GitHub links it to their account. That is
  "Connect GitHub".
- The token of a new link goes to `onAccountCreated`, which keeps it in Loki's
  `accounts`, where the GitHub features read it.
- An address is never an identity. A GitHub account whose address matches an
  existing Loki account that never linked GitHub is refused. The person signs
  in with their password and connects GitHub from there.

Google and X are reached only through the shared bitbaum sign-in
(`SIGNIN_*`). Both were already paused on Auth.js (`PAUSED_PROVIDERS`). That
service is live, but it has no provider credentials yet. Once
`SIGNIN_ISSUER`, `SIGNIN_CLIENT_ID` and `SIGNIN_CLIENT_SECRET` are set,
AccountKit mounts it as `bitbaum-signin`, and the compat layer starts it like
OrangeCat.

An `ENABLE_OWNER_KEY` install that relies only on `LOCAL_AUTH_PASSWORD` (no
stored hash) stays on Auth.js.

AccountKit 0.23 can also sign people in through a product's own GitHub app,
but only when the product asks for it (`githubSignIn: true` on
`createAuthRuntime`, bitbaum/accountkit#61). Loki does not ask: its
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are the app it acts on
repositories with, not a way in. The journey "GitHub, Google, X and the env
owner key are not offered on this runtime" (`scripts/test/accountkit-journeys.ts`)
sets both variables and holds that.

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
stored in `accounts` stay where the GitHub features read them. GitHub sign-in
and "Connect GitHub" run through Loki's own GitHub app (above).

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

On 2026-11-02 `prove` also covered the rest:

- **A real password reset.** Loki's forgot-password page sent the mail to a
  throwaway real inbox. Its link set a new password, and that password signed
  in.
- **OrangeCat's token.** The token a real OrangeCat sign-in left in Loki's
  `accounts` is accepted by OrangeCat's `/oauth/userinfo`, which is what
  publish needs.
- **GitHub, by hand.** The live GitHub button reaches GitHub with Loki's app
  (GitHub names it on its sign-in page), the callback
  `/api/auth/callback/github` and the `repo workflow` scopes. No machine signs
  in to GitHub as a person, so the round-trip itself runs in AccountKit's
  journey against a stubbed GitHub.
