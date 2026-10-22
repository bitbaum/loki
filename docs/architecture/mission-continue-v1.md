# Continue Mission — existing dispatch, no parallel engine

This is a deliberately narrow executable step after the read-only Missions
screens. It does **not** create new mission tasks or execution jobs.

## What the operator sees

On `/missions/[id]` the page combines the same dossier and runtime data
already used on Projects. If the project is idle and the current viewer has
the same `canEdit` capability checked by the dispatch endpoint:

- A recorded, live next step → **Continue mission**. This calls
  `useProjectDispatch(projectId).dispatch("next_step")`.
- No next step but an actual project description or goals → **Start mission**,
  which requests the existing `kickoff` dispatch.
- Missing repository or useful brief → **Complete setup**, linking back to
  the canonical project editor.
- Current building, queued, needs-user, or stalled state → **View progress**,
  not a duplicate prompt.
- View-only access → explanation only, no execution affordance.

The **source of truth for authorization remains**
`/api/projects/[id]/dispatch` → `dispatchStep` → `getProjectAccess` →
`injectPrompt`; the UI guard is only a second layer. The project-owner
infrastructure and provider selection are not reimplemented.

A successful request means **queued/sent**, not finished. The component
reuses `DispatchedNote` to point to Control and Activity and refreshes the
canonical ledger state. Agent completion, CI, and deployment must still be
proven separately; Crew consent and hardware/payment actions are NOT granted
by this button.

## Remaining limitations

- The offer is computed on a server render. A different concurrent action
  could change run state between render and click, so the canonical dispatch
  route is still responsible for the authoritative check. This is not a
  replacement for route-side concurrency protection.
- A repo may exist but be unavailable to the chosen executor. The endpoint
  reports such failures, and the new panel shows its existing error body.
- "Continue" here uses the latest recorded next step; it does not claim to
  execute an arbitrary selected goal. Goal-specific dispatch should be a
  separate, revision-bound enhancement, not a fake argument silently ignored
  by the route.

`scripts/test/mission-continue-dispatch.ts` covers mode selection, active-run
gates, view-only behavior, and the unchanged authorization path.
