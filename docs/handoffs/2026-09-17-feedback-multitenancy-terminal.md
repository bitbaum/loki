# Feedback ownership and Terminal truth — 2026-09-17

## Outcome required

1. A visitor who submits feedback gets immediate confirmation and a clear Loki sign-up/sign-in path. After authentication, their own submissions are visible with implementation status.
2. Project owners and editors can triage and implement feedback. Ordinary reporters can track their report but cannot change the project or dispatch agents.
3. Every feedback row shows its submitted timestamp.
4. Cloud and local Terminal never crash or claim a dead PTY is working. Control, Feedback Watch, and Terminal derive status from the same runtime facts.
5. Production is deployed and walked as reporter, editor, cloud Terminal, local Terminal, and Control.

## Engineering decisions

- `site_feedback.reporter_user_id` links a signed-in reporter without changing the owning project/user fields.
- A 30-day HMAC-signed claim URL records an anonymous feedback ID. After login, the claim endpoint assigns only that ID to the authenticated user. The token contains no feedback text or PII.
- `project_memberships` is the project-level authorization SSOT with `owner | editor | viewer`. Existing `user_projects.user_id` remains the implicit owner during migration.
- Read permissions: owner/editor/viewer see project feedback; a reporter sees only their own submitted rows.
- Write permissions: owner/editor may dispatch and update feedback; owner controls membership. Reporter/viewer cannot dispatch or edit.
- Shared access helpers gate every feedback mutation API. UI affordances follow the same returned capabilities.
- Runtime truth uses builder presence + PTY stream freshness. A run row whose PTY is gone is shown as `Session ended`, never as generating.

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
- [x] Full `pnpm run verify`: 188 unit files, 130 home tests, 30 terminal viewport checks, desktop typecheck/build, infrastructure and operations gates all passed.
- [x] PR #754 merged as `8034cb6`; main CI passed; production reports that commit and migration 0071 is present.
- [x] Production reporter ingest returned a Loki claim URL, claim page returned 200 with tracking copy, unsigned claim returned 401, and the temporary report was removed.
- [x] Production Terminal walkthrough: Cloud rendered without black/stalled state; switching to This computer rendered the missing-session explanation without the null-key crash.
- [x] Production Control walkthrough: `0 working · 0 awaiting input · 23 idle`; the false `3 awaiting input` claim is gone.
- [x] Production Feedback walkthrough: rows show exact `submitted Sep …` timestamps.
- [ ] Follow-up stale-run truth patch: deploy and confirm the old Substrata run says `Session ended` while no PTY exists.
- [ ] Fleet Runner v0.8.28: deploy and confirm a Grok `Weekly limit left: 0%` screen becomes a capacity failure, not a `generating` event.

## Production evidence

- Reported failing URL: `/terminal?project=substrata&run=28ed5be9-3700-4e1a-9819-516ed899ec62`.
- At investigation start, `loki-box-runner.service` was active, while the Substrata Claude PTY had existed for more than one hour and Terminal reported no stream.
- Local source switch raised `Cannot read properties of null (reading 'key')`.
- The v0.8.27 runner restart was initially held by four 90–113 minute idle Claude processes. They were stale, so the runner was restarted at 05:28 UTC; only the runner process remained afterward.
- Authenticated browser audit produced no console errors. Screenshots are on the production box at `/tmp/terminal-cloud-prod.png`, `/tmp/terminal-local-prod.png`, `/tmp/control-prod.png`, and `/tmp/feedback-prod.png`.
- A real Retry on “Easy inference-provider switch” opened Watch immediately and exposed Terminal + Chat links. Run `60071fea-05e8-4812-9b51-b42d69b20ddd` routed correctly to `This computer` + Grok and the command was acknowledged, but Grok's terminal showed `Weekly limit left: 0%`. The v0.8.27 verifier treated that redraw as generation; v0.8.28 fixes this classification.
- The same walk exposed a second routing hazard: the explicit switch-agent API defaulted to Cloud instead of reading the project's `builderPref`. It now routes through the project's execution locus, so a Loki project pinned to `This computer` sends the switch to Fleet Runner.

## Resume point

Ship the small stale-run truth patch, then repeat the exact Substrata Terminal URL. Completion requires `Session ended / No live terminal session` while its PTY is absent.
