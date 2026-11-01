# Agents

<!-- fleet:rules:begin — generated from bitbaum/fleet templates/agent-rules.md; edit it there, not here -->

## Org rules

Read `bitbaum/fleet` `AGENTS.md`, `SHARED.md` and the registers it names before
inventing a host, a name, a page or a shared behaviour. Do not copy their facts
into this file.

- **Packages first.** If a `@bitbaum/*` package (or `bip-kit`, `limitkit`,
  `threadkit`, `ai-forms`) already does it, use it and fix a defect in the
  package, not in this app. Every chat is `@bitbaum/chatkit`, every search box
  `@bitbaum/searchkit`, every chart `@bitbaum/chartkit`, accounts
  `@bitbaum/accountkit`, model calls `@bitbaum/ai-kit`. Review this product's
  `package-plan.json` before building anything. When a second product needs
  what one product built (a map, a globe, a calculator), extract it into a
  package before writing the second copy.
- **A gap is a task, not an answer.** Never end the work, or a reply, at "not
  supported" or "not available". When a source cannot be read or a case does
  not fit the model, find another way (another format or publisher, the
  official tool measured, the model extended) and do it. What truly cannot be
  done yet is tracked with its plan, never presented as a limit of the product.
- **Every page leads to an action.** What a reader learns, they can act on
  from the same screen: file, pay, apply, compare, ask, contact.
- **One shape per kind.** Things of the same kind look the same and sit in the
  same place (fleet `AGENTS.md`, "One shape per kind").
- **Finished work ships by itself.** Open a non-draft pull request; the fleet
  auto-merge sweep is the only merge path. Never merge by hand, through the
  merge API, with `--auto` or with an admin bypass, and never force-push a
  shared branch.
- **Nothing made up.** A fact on a page or in a doc needs a source that was
  opened; where there is none, the line is removed or softened. A gap is
  filled with sourced data, never with a guess.
- **Bitcoin orange is for Bitcoin and top-of-funnel actions only.**
- **No model identifier** in anything pushed to a repository.
- Before you finish, run `node <fleet>/scripts/ci/docs-truth-audit.mjs --dir .`:
  the same check the sweep runs on every pull request.

<!-- fleet:rules:end -->

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

For shared authentication behavior, fix the source in `@bitbaum/accountkit`,
test and release it there, then update consumers. Apps retain roles, tenant
policy, identity migration and domain authorization. Shared chat behavior is
fixed in `@bitbaum/chatkit`; shared model/provider behavior is fixed in
`@bitbaum/ai-kit`. Do not copy a shared implementation into an app to work
around a package defect.
