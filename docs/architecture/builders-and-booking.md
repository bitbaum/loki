---
created_date: 2026-09-24
last_modified_date: 2026-09-24
last_modified_summary: First version — how anyone joins bitbaum as a builder and gets booked, without org peering.
---

# Builders and booking — anyone can build here

**Status:** DESIGN. Nothing below is built except what is marked SHIPPED.

## The ask

The bitbaum studio is at capacity (`bitbaum/site/hire.json` → `availability.state: "closed"`),
and that must not mean nobody can get work done here. Anyone should be able to
**join bitbaum as a builder**, **be booked** by someone who needs work done, and
**be involved in that one project** — on Loki, OrangeCat and Solon, with the
studio neither in the way nor in the money path.

## Where it lives

- **Loki** holds the builder: account, public profile, availability, the
  booking request, and access to the booked project.
- **OrangeCat** holds the money: the builder's service, the booking, and
  settlement to the builder's own wallet. Non-custodial; nobody in between.
- **bitbaum.orangecat.ch** is only the door: a `/builders/` page and the chat,
  both rendered from Loki's public data exactly as the project catalogue is
  rendered from `/api/fleet/map`. No accounts on the static site.

## The trap this design avoids — do NOT model "joining bitbaum" as org membership

`orgs` / `org_memberships` exist, and it is tempting to create a "bitbaum" org
and add builders to it. **That would give every builder the run of every
member's projects.** `getOrgProjects()` (`src/db/queries/user-projects.ts`)
returns the active projects of *every peer in any shared org*, and it feeds
`/api/control`, `/api/control/stream`, `/api/control/agent`, `lib/inject-core.ts`
and `/api/orchestration/run` — i.e. visibility **and dispatch**. Org peering
means "we are one team", which is the opposite of "a stranger I booked for one
job".

The unit of involvement is the **project**, not the org:

- SHIPPED: `project_memberships` (`owner` implicit on `user_projects`, plus
  `editor | viewer`) is the project-level authorization SSOT
  (docs/handoffs/2026-09-17-feedback-multitenancy-terminal.md). An editor may
  dispatch and act on that project's feedback; nothing else.
- SHIPPED (#872): `project_invitations` — invite any email into ONE project,
  account or not; sign-in is OrangeCat, one identity path.

A booked builder is an **editor on the booked project**. That is all the access
the job needs, and revoking it ends it.

## What exists vs what is missing

| Piece | State |
|---|---|
| Open sign-up (password + Sign in with OrangeCat) | SHIPPED |
| Per-user data isolation, per-user AI fair share | SHIPPED |
| Per-project roles + email invites (#872) | SHIPPED |
| Crew: hand a task to a person via share link; paid task → OrangeCat service (#391) | SHIPPED, but crew are the operator's *contacts*, not accounts, and publishing uses the studio's OrangeCat key |
| Agent execution for non-founders: own Fleet Runner | SHIPPED (`src/lib/execution-access.ts`) |
| Shared cloud builder / deploy onto the studio box for non-founders | GATED on purpose (multitenancy-execution-plan.md, `site-cd-register.ts`) |
| OrangeCat services (hourly/fixed), availability, bookings | SHIPPED in OrangeCat, unused by Loki except `services.create` |
| Builder profile (skills, availability, rate, pay link), opt-in public | MISSING |
| Directory of builders + bitbaum `/builders/` page | MISSING |
| Booking request → accept → project invite | MISSING |

## Slices, in order

Each slice ships on its own and is useful alone.

1. **Builder profile.** A `builder_profiles` row per user who opts in:
   headline, skills, availability (`open | limited | closed`), optional rate
   line, OrangeCat profile/pay link. Edited in Settings. Private until listed.
2. **Listing, curated.** A profile is public only once the studio approves it
   (`listed_at`, `listed_by`) — every name on bitbaum's builders page is vouched
   for. Public read: `GET /api/builders` (listed profiles only, the public
   fields only), cached like `/api/fleet/map`. bitbaum renders `/builders/`
   from it; the widget chat reads it so "the studio is full" can be followed by
   "these builders are open".
3. **Booking request.** `POST /api/builders/:username/requests` from a public
   form (rate-limited, deduped, the same shape as `/api/feedback`) lands in the
   builder's inbox. The builder accepts or declines; on accept the requester is
   asked for the project and invites the builder as `editor` (#872 path).
4. **Payment.** The builder's own OrangeCat service and booking, created with
   *their* OrangeCat identity (they sign in with OrangeCat) — never the studio's
   integration key. Loki links to it; it never holds or routes money.
5. **Later, separately:** orgs that own projects (a real team boundary), hosted
   execution for builders once the sandbox gates in
   multitenancy-execution-plan.md are met, and any studio share of a booking —
   which is a Solon decision, not a default.

## Decisions taken (2026-09-24), and what would change them

- **Curated, not open.** Anyone may create a profile; the studio approves the
  listing. Revisit when there is enough volume that approval is the bottleneck
  — then it becomes a Solon rule, not a person.
- **No studio cut.** bitbaum takes nothing from a booking. The studio site must
  not promise revenue shares (`bitbaum/site/PURPOSE.md`); a share, if ever,
  is decided in Solon.
- **Builders' projects do not deploy onto the studio box.** They build on their
  own Fleet Runner and ship through their own accounts until hosted execution is
  isolated.

## Guardrails

- A builder profile never exposes email, contacts, projects or runs — only the
  fields the builder typed for the public.
- `getSelfImprovementTarget()` stays the studio owner for the studio's own
  catalogue; builders do not appear on the fleet map, which is the studio's
  projects, not the people.
- Every public route here follows the widget routes: rate-limited per IP,
  zod-validated, CORS only where a cross-origin caller needs it.
