# Agents

Read `bitbaum/fleet` `AGENTS.md` and the registers it names before inventing a
host, a name, or a page. Do not copy those facts into this file.

Repo-only notes live below this line.

- This product was created from `bitbaum/fleet` `templates/app`. Improvements
  that every product needs go there first, then here.
- Run: `pnpm install`, `pnpm dev`. Done means `pnpm run verify` is green
  (format, lint, typecheck, unit tests, build — the list lives in
  `package.json` and nowhere else); CI runs it verbatim, plus
  `pnpm run test:integration` against a real Postgres.
- **Security and privacy are not negotiable.** The CSP in `lib/security.ts`
  stays nonce-based with `strict-dynamic` and `connect-src 'self'`; secrets at
  rest are sealed (`lib/secrets.ts`); no API returns a secret; nothing logs a
  person's data (ESLint refuses `console.log`). Loosening any of these needs a
  reason written next to the change.
- Accounts are this app's own (better-auth, `lib/auth/`). Every method is
  shown only when its env is set — `lib/auth/methods.ts` decides, and its test
  pins it. A role is never chosen by the person it describes; `pnpm run
role:grant` changes it. People may be pseudonymous: never require a real name.
- Rate limits are limitkit, keyed on the proxy's hop (`lib/limits.ts`). Never
  key on the first `X-Forwarded-For` entry.
- Every string a reader sees is in `messages/en.json`, `de.json`, `fr.json`;
  the parity test fails on a missing key. German uses Swiss spelling (ss,
  never ß). Link with `@/i18n/navigation`, never `next/link`.
- Schema changes: edit `lib/db/schema.ts`, `pnpm run db:generate`, review the
  SQL in the PR. The box applies new migrations forward-only and refuses
  destructive ones.
- The model call is `@bitbaum/ai-kit` `complete()` (`lib/ai.ts`). No vendor
  SDK, no hand-rolled fetch to a model, no pinned model id.
- `ROADMAP.md` and `CHANGELOG.md` are the public record; Loki's fleet map
  ingests them and `/roadmap` and `/changelog` render the map. A user-facing
  change adds a changelog line in the same pull request.
- Every secret the app reads is named in `.env.example`.

Before implementing any feature, read Fleet `SHARED.md` and review this product's
`package-plan.json`. Choose and wire the existing building blocks first; add
product-specific code only for the domain behavior or a documented package gap.
For shared authentication behavior, fix the source in `@bitbaum/accountkit`,
test and release it there, then update consumers. Apps retain roles, tenant
policy, identity migration and domain authorization. Shared chat behavior is
fixed in `@bitbaum/chatkit`; shared model/provider behavior is fixed in
`@bitbaum/ai-kit`. Do not copy a shared implementation into an app to work
around a package defect.

Keep shared fixes in their owning package. Shared package composition CI checks
that adoption is real and that dependency updates remain enabled.

Use Fleet's auto-merge sweep as the merge authority. Do not call the direct
GitHub merge API, use built-in `--auto` merging, or manually merge a PR: those
paths can bypass the docs, CI-freshness and shared-package rollout checks.
Leave a PR open if a required workflow is missing or red.
