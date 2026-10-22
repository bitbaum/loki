# Loki Missions — first working slice

**Status:** Project-backed, read-only UI. This is NOT an autonomous mission
dispatcher. No new database, migrations, background worker or permissions.

## Why the product needs this

Loki already stores project intent and progress in three actual systems:
- `entities` + `attributes`: project identity, `mission` statement, `next_step`.
- `goals`: per-project roadmap, milestone checklists and user-reported progress.
- `orchestration_runs`: actual agent attempts and their outcomes, plus the
  project dev log's latest handoff.

Those are different facts. Treating an AI's progress narration as a completed
human or physical deliverable would make a pretty but dishonest game.

## What is implemented

- `/missions`: private owner-scoped portfolio read from existing `getProjects`,
  `getGoals` and `getProjectsLastDispatch` queries. Each project becomes a
  mission *view*, with either its real saved objective/roadmap or an honest
  invitation to write them in the canonical project editor.
- `/missions/{projectId}`: one mission control view loaded via the existing
  `getProjectDossier(viewerUserId, id)` access path. A project not accessible to
  the viewer is **404**. Displays project mission, next step, goals,
  handoff/test narration and recent run outcomes independently.
- Navigation adds Missions under Build and into command search.
- A pure `missionFromProject` projection that computes `reportedProgress`,
  `goalsReportedDone`, `nextObjective` and a non-authoritative phase label.
  Abandoned goals do not count. A numeric 100% on an active goal does not turn
  it into a completed/verified deliverable. Without goals, progress is absent.
- Existing project workspace remains the only editor and agent-run surface.
  Links open canonical project tabs, Loki chat, and Sessions.

## Explicit truth boundaries

- `phase = reported-complete` means **all non-abandoned Goals have been
  marked completed in the Goals system**, not a signed delivery.
- A run with a successful outcome is a successful *run outcome*; it does not
  verify that an entire mission, test plan, repair, payment, or site deployment
  completed. This view keeps run outcomes and reported goal progress distinct.
- Last-dispatched timestamps are only evidence that an attempt started.
- No mission can contact a Crew member, execute a robot command, spend money,
  publish a device or create an agent run simply by being viewed.
- No approval, payment, or project member authorization is broadened.

## What comes next

1. After the two work-order / Crew PRs are reviewed, add a **trusted evidence
   reference** per objective, cross-linked to the actual run, PR, CI, inspection
   record or signed deliverable. Keep its owner in the source service.
2. Add a read-only link from a Kivvi/evig intake item to its first physical
   refurbishing mission. Do not repeat ERP stock state inside Loki.
3. Add a user-approved, safe `Start/Continue Mission` action that uses the
   **existing** Loki dispatch path. Never bypass Crew's current-acceptance,
   spend, or robot gateways.
4. Only when one real mission completes end to end, extract any reusable
   cross-app wire contract; don't invent a general task database first.

## Verification

`scripts/test/missions-projection.ts` is auto-discovered by the existing Loki
pure-unit-test harness. It covers missing mission definitions, incomplete and
abandoned goals, numeric progress edge cases, tenant-scoped reads, and absence
of write routes. The normal CI must pass before merging or deploying.
