# Client work stays private until the client agrees

Client work is anything built for a real person or organisation, paid or not:
a hosted client site, a pilot, a prospect preview. It is the client's before it
is ours to show. So it appears on a public surface only once the client has
agreed, and that agreement is recorded on the project with how it was given.
Our own products are unaffected.

## The rule, once

`src/lib/register/client-work.ts` (pure):

- **Is it client work?** `user_projects.client_work` when the operator has
  answered (true or false); otherwise the hosting register decides
  (`apps.conf`: kind `client-app` / `client-site`, or an owner that is not
  `bitbaum` / `-`); otherwise it is ours.
- **May it be shown?** Our own work: yes. Client work: only with
  `user_projects.portfolio_consent_at` set. `portfolio_consent_note` says how
  they agreed (an email, a call, the signed offer).

A hosted app with no Loki project has nowhere to record consent, so its client
work is never public. Link a project and record consent there.

## Where it is enforced

| Surface | How |
|---|---|
| `/api/fleet/map` (bitbaum.orangecat.ch, the OrangeCat Cat, substrata) | `buildFleetRegister` defaults to `audience: "public"` and drops unconsented client work. Consented entries carry `client: { consentedAt }`; our own carry `client: null` |
| `/api/fleet/register`, `/fleet`, the public widget chat, the knowledge index's public half | same register, public audience |
| `/u/<owner>`, `/fleet` listing, landing showcase | `withoutPrivateClientWork` (`src/lib/register/portfolio.ts`) on the projects-table queries |
| Footer `FLEET_SITES` | generated from `apps.conf`, static, cannot read consent, so it lists our own products only |
| Operator views (`FleetRegisterNote`, owner-only reindex) | `audience: "operator"`: everything |

A forgotten `audience` argument fails closed.

## Recording it

The project page's share menu has a **Client work** entry
(`ProjectClientConsent`): mark or unmark client work, record consent with a
note, withdraw it. It calls `PATCH /api/projects/:id` with `clientWork`
(boolean or null) and `portfolioConsent` (`{ note }` or null), scoped to the
owner. Withdrawing takes the project off every public surface on the next read.

Listing in the catalogue (`listed_publicly`) is still its own decision: client
work needs both. Prospect previews are created with `client_work = true`.

## The bitbaum portfolio

bitbaum.orangecat.ch renders the map. Client entries reach it only with
consent, and it shows them in their own "Client work" section, apart from the
ventures, never mixed in.
