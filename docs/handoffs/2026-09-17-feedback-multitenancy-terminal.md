# Feedback ownership and Terminal truth — 2026-09-17

## Outcome required

1. A visitor who submits feedback gets immediate confirmation and a clear Loki sign-up/sign-in path. After authentication, their own submissions are visible with implementation status.
2. Project owners and editors can triage and implement feedback. Ordinary reporters can track their report but cannot change the project or dispatch agents.
3. Every feedback row shows its submitted timestamp.
4. Cloud and local Terminal never crash or claim a dead PTY is working. Control, Feedback Watch, and Terminal derive status from the same runtime facts.
5. Production is deployed and walked as reporter, editor, cloud Terminal, local Terminal, and Control.

## Engineering decisions

- `site_feedback.reporter_user_id` links a signed-in reporter without changing the owning project/user fields.
- A short-lived, HttpOnly claim cookie records anonymous feedback IDs. After login, a claim endpoint assigns only those IDs to the authenticated user. The cookie contains signed opaque IDs, no feedback text or PII.
- `project_memberships` is the project-level authorization SSOT with `owner | editor | viewer`. Existing `user_projects.user_id` remains the implicit owner during migration.
- Read permissions: owner/editor/viewer see project feedback; a reporter sees only their own submitted rows.
- Write permissions: owner/editor may dispatch and update feedback; owner controls membership. Reporter/viewer cannot dispatch or edit.
- Shared access helpers gate every feedback mutation API. UI affordances follow the same returned capabilities.
- Runtime truth uses builder presence + PTY stream freshness. A present process without streamed bytes is stalled, never Working.

## Work log

- [x] Read repository and fleet instructions.
- [x] Reproduced the reported production facts from the box: four long-lived Claude PTYs exist; box runner is online; Substrata PTY has been open over an hour while browser stream is unresponsive.
- [x] Repair cloud PTY replay: every SSE viewer requests an immediate buffer snapshot; the runner keeps one subscription and replays on repeated `peek_start`.
- [x] Repair local Terminal null-key crash: a source miss never renders `TerminalView` without a transport.
- [x] Repair Control counts/status agreement: a quiet process is `Agent idle`, not evidence that the user was asked for input.
- [x] Add schema and migration for reporter identity and project memberships (`drizzle/0071_feedback_collaboration.sql`).
- [x] Add signed claim → auth → `/my-feedback` flow.
- [x] Add editor membership UI and API authorization for individual feedback implementation.
- [x] Add visible exact submission timestamps.
- [ ] Tests, PR, CI, deploy, production walkthrough.

## Production evidence

- Reported failing URL: `/terminal?project=substrata&run=28ed5be9-3700-4e1a-9819-516ed899ec62`.
- At investigation start, `loki-box-runner.service` was active, while the Substrata Claude PTY had existed for more than one hour and Terminal reported no stream.
- Local source switch raised `Cannot read properties of null (reading 'key')`.

## Resume point

Run full verify, open and merge the PR, let the guarded deploy apply migration 0071 and restart the box runner, then execute the production walkthrough. Do not declare completion until the production walkthrough passes all five required outcomes.
