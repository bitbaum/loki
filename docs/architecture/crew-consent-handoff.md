# Crew: consent-safe assignment edits

The Crew human-task table remains the sole source of truth. This change does
not create a replacement task queue or an automatic human dispatch feature.

## The bug

An operator could change the assignee, scope, deadline or fee after a person
answered through a share link. The assignment could still read `accepted` or
`delivered` even though that response concerned an earlier ask. Concurrent
operator edits and assignee replies could overwrite one another, because the
mutations previously read and wrote without locking the same row.

## New behavior

- A *material* edit to the assignee, project, title, brief, reason, due date,
  fee amount or fee currency restores the assignment to **draft** and revokes
  the current share link. Historical notes stay in the timeline but are not
  proof that the current assignee accepted the revised task.
- Assignment, response, delivery and completion timestamps are cleared for
  the revised ask. An operator must intentionally share it again; sharing a
  draft mints a new bearer token instead of recycling the revoked link.
- Purely cosmetic/no-op edits, or adding a note, do not revoke a share.
- Editing closed assignments requires explicitly reopening them first.
- Editing material terms and moving to a non-draft status in one request is
  rejected with **409 Conflict**, because it bypasses the fresh-ask boundary.
- Share, edit, revoke and assignee responses now use `SELECT ... FOR UPDATE`
  on the **same** human-task row and write the timeline event in the same
  transaction. When an old link is revoked, its subsequent response cannot
  mutate the latest assignment.
- The existing private-zone API surfaces invalid edit transitions as 409
  rather than an unexpected 500.

## Known limitations and follow-up

A share link is a *bearer credential*, not a verified identity signature. A
person holding the link can answer; the system still cannot prove a specific
human's real identity from that action alone. For this reason, generic
work-order dispatch must **not** infer `AcceptanceStamp` from the Crew
status or history. The read-only bridge proposed in PR #1365 correctly treats
current-assignee consent verification as unavailable.

Existing published OrangeCat service listings may retain outdated terms
after an edit. This change deliberately does not send automatic payments or
delete listings across systems. Reconciliation and a reliable cancellation/
amendment flow remain necessary before marketplace settlement is automated.

No new migration is required; the change uses row-level PostgreSQL locking.
An integer monotonic revision and explicit assignee/revision-bound acceptance
receipts remain important for future signed cross-service execution.

## Verification

`scripts/test/crew-consent-handoff.ts` is discovered by Loki's existing
unit-test harness. It verifies all material term fields, equality cases and
the locking/event boundaries. The normal GitHub CI also typechecks the query
implementation. Real concurrent traffic and deployment behavior still need
staging integration tests before activating automatic external dispatch.
