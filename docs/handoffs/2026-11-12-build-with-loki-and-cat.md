# Build with Loki and with a Cat bot — checkpoint, 2026-11-12

One queue for work that spans `bitbaum/loki` and `bitbaum/orangecat`. Any agent
can continue from this file without the chat that started it; `AGENTS.md`
points here. This session changed nothing in OrangeCat, so that repository
carries no record of its own for this work.

## The objective, in the owner's words

> Make Loki functional, so I can build with it instead of Claude Code. Make Cat
> Bot functional, so I can build with it instead of Grok Bot. Test in production
> ensuring the goal is achieved. Update me and document everything so there is
> continuity in case you run out of tokens.

## What "functional" is taken to mean (acceptance criteria)

Two journeys, each proven on the production sites, not on a laptop:

| # | Journey | Proven when |
| - | ------- | ----------- |
| A | The owner tells **Loki** what to build, from a phone | a production run exists that started from a message, an agent on the cloud builder did the work, a pull request merged through the fleet sweep, the deploy went out, and Loki told him the truth about each step |
| B | The owner tells a **Cat bot** what to build | a production conversation exists where a bot sent the task to Loki, read the run's status back and reported the result in the chat |

A step is recorded here as **implemented**, **checked**, **merged**, **deployed**
or **exercised** — never one for another (fleet `docs/repository-completion.md`).

## How production can be reached from an agent session

The session that started this had no box key, no database tunnel and no
signed-in browser. What it could use:

- public, signed-out `GET`s against `https://loki.orangecat.ch` and `https://orangecat.ch`;
- GitHub Actions history and logs of both repositories;
- `workflow_dispatch` workflows that hold the box key (for example
  `box-doctor.yml`, `builder-agents.yml` with `probe_only`, OrangeCat's
  `cat-diagnostics.yml` and `live-rehearsal.yml`).

## State when the work began (2026-11-12 05:13 UTC)

- Loki production `/api/health`: `ok`, commit `546d2ce` (main's tip at that minute).
- OrangeCat production `/api/health`: `healthy`.
- Other sessions had these pull requests open on the same path. They are not
  this session's to push to; a change here must not collide with them:
  - loki: #1640 (a "fresh" one-off session), #1643 (merged 05:2x UTC), #1644
    (signed read of sessions for OrangeCat), #1645 (Loki's own project on the
    cloud builder), #1646 (a task can name the cloud runner, answers with a
    status address), #1647 (one run status), #1648 (feedback inbox over the
    signed rail), #1649 (control stream leaked a Postgres connection per page
    view), #1650 (runner auth canary), #1651 (who holds Postgres connections).
  - orangecat: #1614 (bot turn timing), #1611, #1609, #1593.

## Log

| When (UTC) | What | Result |
| ---------- | ---- | ------ |
| 05:13 | Probed both production health endpoints | both answer 200 |
| 05:20 | Started a ten-way read-only investigation of both journeys | **cut short**: 12 of its 14 agents stopped on the account's usage limit. Two Loki maps came back (message → agent start; agent working → shipped). Nothing came back for the Cat bot, Loki's chat, the builder's state, the open pull requests or a scripted production test. The skeptic pass and the completeness critic did not run, so every finding below is one investigator's reading until re-checked. |
| 05:25 | Pushed this file to `origin/ccr-6043476f-vhm900` | pushed |
| 06:04 | Loki production serves `9253f40`; #1640 #1643 #1644 #1645 #1646 #1647 #1648 merged meanwhile (other sessions), so Loki's side of the bot rail is on main | read from `/api/health` and `git log origin/main` |
| 06:05 | Dispatched `sealed-builds.yml` `mode=journal` (read-only) to see the runner's version and whether it claims work | run 43165605499: one runner process all hour (never restarted); the drain logged "5 agent(s) working — deferring restart" on every look from 05:41 to 06:06 and restarted its clock at each deploy; the poller claimed `peek_start` / `peek_stop` and nothing else. The update hold is the live blocker. |
| 06:23 | Opened [#1663](https://github.com/bitbaum/loki/pull/1663) (change 1) | CI `check` green at 06:38 UTC. The fleet sweep's runs sat queued: every Actions job waited about twelve minutes for a runner that morning, with a dozen agent sessions pushing at once. |
| 07:19 | Folded change 2 into #1663 and pushed | CI `check` green at 07:37 UTC |
| 07:56 | `sealed-builds.yml` `mode=activity` from the branch (read-only) | three sealed sessions, 0 / 96 / 40 bytes in a minute, all counted as working (see change 3) |
| 08:48 | #1663 merged by the sweep as `64e2c6b` | 70 minutes after its checks went green: the sweep takes the lowest-numbered green pull request, one at a time, and waits for main's CI between merges |
| 09:03 | Loki production serves `64e2c6b` (#1663) | read from `/.well-known/fleet-release.json` |
| 09:05 | The runner claims work again | Sealed builds run 43193588686 (`mode=journal`): `[poller] claimed dispatch` and `acking dispatch command: ok` at 09:05, 09:07, 09:09, 09:19 and 09:40 UTC. Between 05:41 and 06:07 it had claimed screen peeks only. |
| 09:06 | **Claude on the box is out of usage** | same journal: three dispatches rejected at 09:06:14, 09:06:43 and 09:07:02 with "claude cannot generate because its usage limit is exhausted. Switch this project to a provider with available capacity, then Retry." |
| 09:11 | First run of `loki-loop-check.yml` (run 43188095136) | "could not mint a session on the box" in two seconds, and a green job: see change 4 |
| 09:19 | OrangeCat `live-rehearsal.yml` again, on the newest release (run 43188158095) | job success |
| 09:23 | #1676 merged by the sweep as `7718294` (change 3 and the composer fallback) | the check's fix missed it by a minute and is #1678 |
| 09:25 | `loki-loop-check.yml` from the branch with the fix (run 43191224470), `dispatch=true`, project `loki` | **4 of 5 passed, journey A not proven.** Pass: Loki answered a fleet question from the map (on the owner's xAI key); the map is public with the three pillars live (30 projects, 16 live); bitbaum shows the same map; the task was accepted for the cloud runner. **Fail: the task was still "Queued" after 35 minutes** and the check aborted it. The runner was claiming other dispatches in that time (09:39 UTC), so this task was held back for the `loki` project in particular; the check could not say why and guessed. |
| 10:04 | The check prints Loki's own reason (the run route's `detail`, the chat reply's words); short re-run from the branch (run 43196890919, project `loki`, 8 minutes) | 4 of 5 again, and now it says why: 'Sent **loki** to the cloud runner. This project is still on an earlier task. Yours is next in line and starts when that one ends. To start it now, open the project's session and send it there, or stop the earlier task.' That is #1663's sentence, live. The `loki` project has had an earlier run open for at least 45 minutes; whether its agent is working or idle at its prompt is not known. The journal shows automated incident dispatches (`incident-dispatch.sh`) and a sibling session's probe going to that project. |
| 10:14 | Asked the runner/queue session whether it takes the stuck lane and the session cap | no answer yet |
| 10:14 | Same check asked for project `orangecat` (run 43198552471, 20 minutes) | 4 of 5, and it had not reached `orangecat`: 'Sent **loki** to the cloud runner.' A project named in a message outranks the selected one, and the probe's marker was `[loki-e2e]`. So all three runs had probed the busy `loki` project. |
| 10:38 | Routing fix and a marker that names no project, pushed to #1678; fourth run asked for `orangecat` (run 43202154115, 25 minutes) | 4 of 5, and this time it reached the project: 'Sent **orangecat** to the cloud runner. This project is still on an earlier task. Yours is next in line…'. Still queued after 25 minutes. |
| 11:11 | The runner/queue session answered | it has nothing open and is not changing the gate, the close paths or the runner's launch; this session takes the stuck lane. It also flagged that `capacityFailureFromScreen` may read an agent's own tool output as a usage wall, so the three 09:06 rejections may not have been real limits. |
| 11:14 | `sealed-builds.yml` `mode=journal` on main (run 43206767629), the hour 10:14–11:14 UTC | **The owner's own work went through Loki end to end.** 10:26:55 `claimed dispatch`, `[box-prepare] orangecat: run … starts`, the message was an addition to the bot-platform workstream; 10:29 the agent had committed `docs/PARITY.md`; 10:41 it opened bitbaum/orangecat #1664; the sweep merged it at 10:53:41. 10:41:38 the next message for `orangecat` was claimed, and 10:59:55 a third one started in a lane of its own (`orangecat~ed39e1e1`). So `orangecat` really was on earlier tasks while the fourth probe waited: the sentence it got was true. |
| 11:14 | Same journal | That third message reports an outage: since 09:49 UTC every OrangeCat bot send answers 502 `AI_ERROR`, two minutes after the Gemini API was switched off, and asks for the bot and Cat provider chain to leave Google. An agent on the box is on it. The 09:04 rehearsal (success) was before the outage. |
| 11:14 | Same journal | `[run-progress] beat failed: The operation was aborted due to timeout` at 10:57 and 11:03, and `[workspace-source] …: aborted due to timeout` nine times between 10:56 and 11:09: the server answered the runner slowly in that window. Not looked into. The drain read 7 then 8 agents working; they are. |
| 11:17 | OrangeCat `live-rehearsal.yml` started again (run 43207879959) | **failed**: 1 passed, 3 failed (the shelf bot, the hands card, asking Loki), 1 flaky, 2 did not run, 9.3 minutes. The retries died in `beforeAll`: `page.goto /auth … networkidle` over 30 s. |
| 11:30 | `https://orangecat.ch/api/health` | 200 after 6.2 s, `host.mem_used_pct: 96`, disk 73. `cat-diagnostics.yml` (run 43209675047): `{"matched": 0, "failures": []}`, so it does not count a bot's failed send. |
| 11:31 | The same demo run from this session against the live site | `/auth` draws, but does not settle: `https://loki.orangecat.ch/api/widget-boot` took 7.3 s. |
| 11:33 | "Start instantly" in a browser here | `POST https://supabase.orangecat.ch/auth/v1/signup` → **504 `request_timeout`** after 13 s; the page stays on `/auth` and says nothing. A new person cannot start. (OrangeCat #1667, open, is another session's fix for what the page says after a slow sign-in.) |
| 11:36 | `https://orangecat.ch/api/health` sampled | connection reset twice, 503 for about 40 s, then 200 in 0.4 s. The served release is still `e18ee8de` (10:43), not #1664's merge. |
| 11:39 | One bot turn from a browser here, as a brand-new person (sign-up took 11 s this time) | **a bot does not answer on the live site.** `POST /api/ai-assistants/<id>/conversations/<id>/messages` → `502 AI_ERROR`, "The AI service could not answer just now. Try again shortly." Under the composer: "That did not go through. Try again." The chain is Groq, then Google, then OpenRouter's free pool (`servingChain`, `src/services/cat/provider-catalog.ts` in OrangeCat); with Google off the free links behind it do not carry the load. |
| 11:46 | OrangeCat **#1672** opened: the failed send says the truth with the "Use your own key" button, and `cat-diagnostics.yml` counts unanswered bot turns by vendor and status | CI running; it does not restore the pool |
| 11:39 | Loki #1678 `check` | success on `0e48feb4` (the real-Postgres scenarios ran in CI). Waiting for the sweep; #1661 and #1673 merged ahead of it. |
| 11:30 | `box-usage.yml` `mode=read` (run 43209749814) | cancelled at its 20-minute limit inside the first `du`, after printing the memory facts: **MemAvailable 0.6 GiB of 15.2, swap 4.0 GiB of 4.0 used.** Resident memory by program: `gvisor_sentry` 25186 MiB over 1734 processes (the sealed agent sessions; shared pages are counted once per process, 6.5 GiB is shared), `next-server` 3847 MiB over 24, `postgres` 2112 MiB. **20 out-of-memory kills since boot**: `openclaw-gateway` 10, `gvisor_sentry` 3, and one each of `next-server`, `java`, `python`, `node`, `bash`, `MainThread`. |
| 11:55 | Read `src/lib/agent-execution/sandbox.ts` and `scripts/hetzner/install-box-runner.sh` | A sealed session started with podman gets no `--memory` (only the docker shape does); the code says "MemoryMax still bounds them", meaning the runner unit's. `loki-box-runner.service` has `OOMPolicy=continue` and **no `MemoryHigh` or `MemoryMax`**. Every site unit has `MemoryMax=1G` (`scripts/hetzner/sync-infra.sh`). So the builder is the one service on the box with no ceiling. `AGENT_MAX_OPEN_DEFAULT = 8` was sized at 0.4 GB a session. |
| 11:58 | `box-usage.sh` now prints the runner unit's memory, its ceiling and the sandboxes' cgroup, and gives each disk walk a minute; run from the branch | result below when it is in |
| 11:28 | Change 6 written and tested (below): a red or conflicted pull request is said in the thread with the repair | `scripts/test/run-follow-notify.ts`, and the eleven other tests that read the shipping ledger |
| 11:20 | Change 5 written and tested (below) | `scripts/test/quiet-lane.ts` 14 checks; `scripts/test/lane-and-reaper.ts` 13 of 13 against a local Postgres 16 with pgvector, migrated with `drizzle-kit push` as CI does |
| 09:40 | The drain reads "8 agent(s) working" | eight is the cap on open agent sessions (`src/lib/agent-session-limit.ts`); the drain's clock restarted at 09:11, 09:22, 09:29 and 09:34 with each deploy |
| 06:31 | OrangeCat `cat-diagnostics.yml` (read-only) | no Cat failure logged in the last hour |
| 06:40 | OrangeCat `live-rehearsal.yml` | 7 passed (see journey B) |
| 06:10–06:23 | Wrote the fix (below) on `ccr-6043476f-vhm900` | checked locally: `tsc`, eslint on the changed files, `scripts/test/runner-update-hold.ts` and the eleven tests that read the changed files. `test:ops` stops at `test-host-alerts.sh` with 4 failures that an untouched tree shows too in this sandbox. Full `verify` is CI's. |

## Change 1 (Loki): a held task waits minutes, and says so

Branch `ccr-6043476f-vhm900`. Server and box scripts only: no runner code, so
no runner version bump, no collision with #1650 / #1652 and no new hold.

- `src/lib/runner-update-hold.ts`: a held command is handed over once it has
  waited `UPDATE_HOLD_MAX_MS` (5 minutes); the hold applies only within
  `UPDATE_HOLD_WINDOW_MS` (2 hours) of the newest runner release's date.
- `src/db/queries/pending-commands.ts` `claimNextPendingCommand`: an
  `overdue` rule (held types become claimable by age). While holding, an
  empty at-once list now claims nothing; it used to claim everything.
- `src/app/api/control/commands/route.ts`: applies both.
- The person is told: `BUILDER_UPDATING_SENTENCE` in the chat reply
  (`src/lib/dispatch-status.ts`), in the `/api/inject` answer
  (`builderUpdating: true` and `message`, `src/lib/inject-core.ts`) and as the
  run track's headline while the job is unclaimed (`queueNote`,
  `src/lib/run-track.ts`, `src/lib/run-track-load.ts`).
- `.github/workflows/loki-loop-check.yml` (new): the production check of the
  whole loop, on demand. Without inputs it asks Loki a fleet question and
  reads the map; with `dispatch=true` it sends one real no-change task to an
  agent on the cloud runner and waits for the outcome to come back into the
  thread. It runs `scripts/hetzner/loki-e2e-check.sh --report` on the box.
- `sealed-builds.yml` `mode=activity` (new, read-only): per agent process of
  the runner unit, what the drain sees and the bytes it read and wrote over a
  minute. This is the measurement the drain's rule needs before it can tell
  an idle sealed session from a working one.
- `.husky/pre-push`: the watchdog's `sleep` no longer holds the caller's pipe.

What it does not do: make the restart land. The drain still counts every
sealed session as working. Next step for that: run `mode=activity`, read the
numbers, then change `agent_is_busy` in
`scripts/hetzner/drain-and-restart-runner.sh` on what they show.

## Change 6 (Loki): a pull request that cannot merge is said, with the repair

The fleet's sweep merges a green pull request and leaves a red or conflicted
one waiting (`bitbaum/fleet` `scripts/ci/auto-merge-sweep.sh`: "a red or
pending PR simply waits"). A task that ended at such a pull request read
"done, it merges on its own" until somebody opened GitHub.

- `src/lib/feedback/fix-shipping.ts`: `PrBlocker`, `prBlockerFor` (a
  conflict when GitHub says `mergeable: false`, else the names of the checks
  that failed; `cancelled` and still-running are not failures),
  `prBlockerNews` (once per commit and reason).
- `src/lib/feedback/fix-shipping-refresh.ts`: `readBlockers` on the refresh
  input; only then are the head commit's check runs and statuses read.
- `src/lib/run-follow-notify.ts`: the fifteen-minute follower asks, and on
  news writes one line into the thread the task came from and sends one
  push. `src/lib/run-shipped-message.ts` `chatRunBlockedMessage` holds the
  words. The line ends with the message to send, for example
  "orangecat: fix the failing checks on <pull request> and push to the same
  branch." A message that names a project is a task for it, so the way
  forward is one paste on a phone.
- Loki does not send the repair itself. `lib/auto-dispatch` records the
  owner's rule of 2026-09-29: no agent run that nobody asked for.

Tests: `scripts/test/run-follow-notify.ts`. Not proven on the live site: it
needs a chat build whose pull request is red or conflicted.

Not done: the run's card does not show the blocker (only the thread line and
the push do), and there is no one-tap button for the repair.

## Change 5 (Loki): a silent run gives its project to the waiting message

A project's shared session takes one message at a time; the claim gate holds
the next one until the run ahead has closed. A run closes when its agent
reports (a handoff, a pull request). An agent that ended its turn without
reporting still has a process at its prompt, and the reaper shelters a run
with a live process for up to `MAX_RUN_HOURS` (12). So the next message could
wait twelve hours behind a session doing nothing, with "Next in line" on the
screen the whole time.

- `src/lib/orchestration/quiet-lane.ts`: the rule, pure. The runner beats
  while the terminal prints and while the agent waits at a sign-in or an
  approval. At least one beat ever (a runner from before beats existed
  reports nothing while its agent works, so its silence proves nothing),
  then no beat for 20 minutes (twice the window after which every surface
  already says Stalled), not waiting for a person, no command outstanding,
  and still so 90 seconds after it was first seen: release. The
  second look is there because a runner that lost its connection cannot beat,
  and its first request back may be the claim.
- `src/db/queries/quiet-lane.ts`: gathers those facts for the run at the head
  of each lane a message waits in (through `olderOpenRunSql`, the gate's own
  definition) and closes it: `partial` with the handoff note when the project
  pushed a handoff, else `timeout` with "The agent printed nothing for N
  minutes and did not report back, so this run was ended and the next message
  for the project started." The end time is the last beat. No escalation.
- `claimNextPendingCommand` calls it before the gate, so the waiting message
  is claimed in the request that closed the run.
- The sentence a person reads while waiting now carries the bound: "…it
  starts when that one ends, or once that one has printed nothing for 20
  minutes."

What it does not do: release a working agent. A working agent prints, so its
beat is seconds old at any age. Nothing is closed when nobody is waiting.

Tests: `scripts/test/quiet-lane.ts` (the rule), and five scenarios in
`scripts/test/lane-and-reaper.ts` against a real Postgres (released on the
second look and claimed at once; a printing run keeps its lane at eleven
hours; a beat between the two looks keeps it; an approval prompt keeps it;
a run that never beat keeps it; nothing happens with nobody waiting). To run the second one locally:
`pg_ctlcluster 16 main start`, `apt-get install postgresql-16-pgvector`,
create a database, `CREATE EXTENSION vector`, `DATABASE_URL=… npx drizzle-kit
push --force`, then `TEST_DATABASE_URL=… npx tsx scripts/test/lane-and-reaper.ts`.

Not proven on the live site yet: it needs a project whose earlier run has
gone silent while a message waits.

## Change 4 (Loki): the on-demand check can sign in (#1678)

`loki-loop-check.yml` was added in #1663 to prove the loop on the live site.
Its first run could not start, for three reasons, all fixed in #1678:

- The deploy ships the runner a fixed list of scripts
  (`scripts/deploy-hetzner.sh`, the `sync_runner` list) and nothing under
  `scripts/test`, so the test and the token script were not on the box. The
  workflow now copies its own files to `/opt/loki/runner/scripts/test/`.
- The check minted an Auth.js session cookie; sign-in is AccountKit since
  2026-11-01 and that cookie is no session. It now mints an agent token for
  the operator (`scripts/test/mint-check-token.ts`, label `loki-e2e-check`,
  two hours, removed on exit) and signs in with it as a bearer.
- A check that could not sign in exited 0. It now says why and exits 1.

Also in #1678, found through the check:

- **An address to the assistant is not the loki project.** A project named in
  a message outranks the selected one (`src/lib/loki-fleet-commands.ts`, on
  purpose), the assistant is called Loki and so is a project, so "Loki, add a
  dark mode toggle" typed with orangecat selected went to the loki project.
  `withoutAddressTo` in `src/lib/project-mention.ts` removes an address (the
  name at the start with punctuation, after a greeting, `@loki`, or after a
  comma at the end) before matching. "Loki's sidebar", "in loki" and a bare
  "Loki fix the header" still name the project.
- The check prints Loki's own words for a task that does not start, uses the
  marker `[e2e-probe]`, and fails at once when the task went to another
  project than the one it asked for.

`scripts/test/print-session-token.ts` and `scripts/test/authenticated-smoke.ts`
still mint the Auth.js cookie; any script that relies on them cannot sign in
to production until they are moved the same way.

## Change 3 (Loki): the runner's restart can land

Merged as #1676 (09:23 UTC, `7718294`), together with the composer fallback:
`/api/control/tab-inject` passes the project's offline fallback, so a project
registered from a computer that is shut goes to the cloud runner from the
project composer as it already did from the chat.

Measured on the box at 07:56 UTC with the new read-only read
(`sealed-builds.yml` `mode=activity`, run 43178274733, dispatched from the
branch before the merge): the owner's runner unit held three sealed
sessions. Over one minute their relays moved 0 bytes (a session 18.1 hours
old), 96 bytes and 40 bytes (two sessions 3.2 hours old). The drain logged
"3 agent(s) working — deferring restart" on both looks in that minute. The
runner fixes merged that morning (0.8.67 and later) were live in the app and
not running on the box.

- `scripts/hetzner/drain-and-restart-runner.sh` `agent_is_busy`: a sealed
  session that has relayed under 512 bytes a look for 30 minutes
  (`LOKI_RUNNER_QUIET_SECS`) is not working. `quiet_for` keeps its note under
  `/run/loki-drain/<unit>` so the clock survives each deploy's new drain.
- Unsealed agents are unchanged: their output was not measured.
- Known cost: a sealed agent stopped at a permission prompt mid-task prints
  nothing, so after thirty silent minutes the restart goes ahead; the session
  reopens and its open run is closed.
- Not measured: what a working sealed session relays. `mode=activity` during
  a real task gives that number; the threshold is five times the largest idle
  figure seen.

## Change 2 (Loki): the run tells the truth after the agent finishes

In the same pull request as change 1 (#1663): the sweep merges one pull
request and then waits for main's CI, about twenty minutes a merge that
morning, so a second pull request would have queued behind the first. Server
only, plus one prompt line the runner reads at its next start; no file under
`desktop/`.

- **The "done" message finds the run's pull request.** The runner's own report
  (`payload.prUrl`, written by `closeRunShipped`) is read first
  (`reportedPrEvidence`, `src/lib/repo-evidence.ts`), and GitHub is asked with
  the token that can read the repository (`repoTokenFor`) in
  `src/lib/orchestration/run-outcome-post.ts` and `reap-evidence.ts`. The
  person's own OAuth token is refused on the organisation's repositories, so
  a run that shipped could be posted as "No pull request or push was found".
- **"Live" is read from the site.** `src/lib/feedback/served-release.ts`: a
  merged change is live when the commit in the site's
  `/.well-known/fleet-release.json` is the merge or comes after it (one
  guarded public read, one GitHub compare). It only upgrades; with no
  receipt the workflow-run verdict stands. `FixRefreshInput.liveUrl` is
  required so no caller can leave it out.
- **A task behind the project's earlier run says so** (`QUEUED_BEHIND_SENTENCE`
  in the chat reply, `queuedBehind` and `message` in the `/api/inject` answer,
  the track's headline), instead of "will claim it shortly".
- **Isolated runs ship through a pull request.** `worktreePromptNote` told
  every lane and one-off session to `git push origin HEAD:main`.
- The close message no longer prints `Live: <address>` beside a pull request
  that has not merged.

- **A chat build is followed to live.** `src/lib/run-follow-notify.ts`, called
  from the existing fifteen-minute cron
  (`src/app/api/crons/check-feedback-needs-you/route.ts`, so no new timer):
  runs that came from a conversation, finished well in the last 48 hours,
  ledger not terminal → the same ledger refresh (GitHub and the receipt, no
  model) → on the change to live or to a failed deploy, one line in the
  thread and one web push. A live moment more than two hours old is stamped
  and not announced, so the first tick does not report two days of history.
  The words are in `src/lib/run-shipped-message.ts`.

## Still open after change 2 (journey A), in the order I would take them

1. **Whether the push reaches the owner's phone** is not known from here:
   it needs web push configured on the box and a subscribed device
   (https://loki.orangecat.ch/settings → Notifications → Turn on
   notifications → Send a test). The line in the thread is written either way.
2. **A red or conflicted pull request**: change 6 says it in the thread and
   by push, with the message that repairs it. Still open: the run's card
   shows nothing of it, and the repair is a message to paste, not a button.
3. **The drain's rule** for sealed sessions is change 3. Still to measure:
   what a working sealed session relays, and whether unsealed agents that are
   not Claude can be told idle the same way.
4. **The session cap**: a ninth dispatch is accepted and then refused with
   "8 agent sessions are already open on the cloud builder… Close one you are
   not using, then try again." Nobody has taken this. The way forward that
   fits a phone: at the cap, Loki closes the session that has been idle
   longest (no open run, quiet at its prompt) and starts the new one. It is
   runner code (`desktop/src/main/pty-runtime.ts`), so it lands only with a
   runner restart.
5. **"Create project X and build it"** from the chat queues a command no
   runner can start; it should start the kickoff.
6. The project composer for an idle project (`/api/control/tab-inject`) does
   not share `injectPrompt`'s routing.

## Other sessions on the same path (12 Nov, from the session list)

- "Loki: runner folder + queue + status" — the runner fixes (#1650, #1652,
  runner versions up to 0.8.68). Told at 06:25 UTC which files change 1
  touches and that the drain rule and `desktop/` are left to it.
- "Bot platform: Grok-Bot parity through Loki" — journey B itself: the bot's
  Loki hands on OrangeCat (#1610, #1613, #1614, #1615) and Loki's side of the
  rail (#1644, #1646, #1648). Asked at 06:25 UTC what is unproven on the live
  site and how a bot's Loki hand can be exercised without the owner's phone.

## Journey B, what is known

- Loki production, signed out, 06:20 UTC: `/api/orangecat/task` 405,
  `/api/orangecat/sessions` 405 (both exist), `/api/orangecat/feedback` 404
  (merged as #1648, not yet deployed at that minute).
- OrangeCat `cat-diagnostics.yml` run 43167860986 (06:31 UTC):
  `{"matched": 0, "failures": []}` for the last hour.
- OrangeCat `live-rehearsal.yml` run 43167876838 against
  `https://orangecat.ch`, as a brand-new person: **7 passed in 10.3 minutes**
  (06:30–06:40 UTC). The list of bots with the Cat first; a ready bot reads a
  letter and keeps the thread; a group where each specialist keeps its lane;
  a bot proposes an event and the tap creates it; a bot asks Loki twice; a
  routine set, shown and stopped; the API's edges. Two of the demos took over
  four minutes each. This exercises a new person's bots, not a bot working in
  its owner's Loki (#1615, which needs an account linked to a Loki account
  that has projects).
- 09:49 UTC onward: the journal on the box carries a dispatched task saying
  every bot send answers 502 `AI_ERROR` since the Gemini API was switched
  off, with an agent working on moving the provider chain off Google
  (`orangecat~ed39e1e1`, claimed 10:59:55 UTC). `live-rehearsal.yml` was
  started again at 11:17 UTC to read the state from outside.
- **11:39 UTC, first hand: a new person's bot gets no answer** (502
  `AI_ERROR`). A person's own key is asked before the shared pool
  (`src/services/ai/sendMessage-internals.ts` in OrangeCat), so the owner's
  bots answer on his own key whatever the pool does: add it at
  https://orangecat.ch/settings/ai . OrangeCat #1672 makes the failed send
  say that, with the button.
- What is not proven on the live site: a bot of a Loki-linked person sending
  a task, following the run and reporting the agent's answer.
- A bot's task to Loki rides the same queue as the chat, so change 1 is a
  precondition for journey B as well.

## Findings so far (journey A, Loki)

Read in code by one investigator each; "prod" marks what production evidence backs it.

### What stops a message from becoming running work

| Id | Finding | State |
| -- | ------- | ----- |
| `update-hold-never-releases` | While the cloud builder's version is behind the app's newest runner release, the commands route hands it no `dispatch`, `launch_agent`, `auto_continue` or `browser_task` (`src/lib/runner-update-hold.ts`, `src/app/api/control/commands/route.ts`). The hold has no time limit. The restart that lifts it (`scripts/hetzner/drain-and-restart-runner.sh`) waits for every agent to be idle, counts every sealed session and every agent that is not Claude as working, gives up after six hours and is not retried. The chat meanwhile says a runner will claim the task shortly. prod: two deploys on 12 Nov printed "7 agent(s) working" and "5 agent(s) working — deferring restart"; two runner releases (0.8.65, 0.8.66) landed within 35 minutes. | **suspected live blocker**; being confirmed |
| `session-cap-refuses-new-project` | The cloud builder allows eight open agent sessions. A ninth dispatch is accepted, then refused by the runner; nothing closes an idle session to make room. #1652 (open) closes a session after six idle hours. | open |
| `busy-project-message-waits-unsaid` | A message to a project that has an open run queues behind it, up to twelve hours when that agent sits idle at its prompt, and the chat still says it starts shortly. #1646 added "a busy project says so" for the OrangeCat rail; the chat path was not re-read after it merged. | re-check |
| `composer-queues-for-offline-laptop` | `/api/control/tab-inject` (the project composer for an idle project) does not fall back to the cloud when the project is pinned to an offline laptop; only `injectPrompt` does. #1645 moved the `loki` row only. | open |
| `chat-create-project-cannot-start` | "Create project X and build it" in the chat creates a project with no repository and queues a bare `inject` that no runner can start. The kickoff path that creates the repository exists and is not used there. | open |
| `auth-canary-fails-healthy-runs` | A new run is failed as "not signed in" on an old transcript in the same folder. | #1650 (open, conflicted on the runner version line) |

### What stops the owner learning the truth after the agent finishes

| Id | Finding | State |
| -- | ------- | ----- |
| `ledger-live-by-run-label` | "Deploying / Live / deploy failed" is decided from workflow runs labelled with the merge commit. A Deploy run is labelled with main's tip at trigger time, not the commit it ships; OrangeCat's deploy workflow is named CD and never matches. Every site serves `/.well-known/fleet-release.json` with the commit it runs: decide from that. | open |
| `chat-run-not-followed-to-live` | A build started from the chat ends at "pull request opened". Nothing follows the pull request to merged, red, conflicted or live unless the owner keeps the card open. | open |
| `red-or-conflicted-pr-dead-end` | A run's pull request that is red or conflicts has no way forward in Loki; a green but conflicted one reads "Tested — merging". #1599 (a Loki run's branch) has been red since 6 Nov. | open |
| `outcome-post-wrong-token` | The "done" message looks for the pull request with the person's own GitHub token (refused on org repositories) and ignores the URL the runner already reported, so a good run can be posted as "Nothing reached the site". | likely; open |
| `repo-progress-time-window` | The track's commits and checks still come from "the newest pull request in the repository since the run began". | open |
| `worktree-note-push-to-main` | Every isolated run (lane, fresh session) is told to push straight to main (`src/lib/agent-execution/worktree-workspace.ts`), against the fleet rule and against branch protection. | open |
| `idle-agent-holds-lane` | An agent that ends its turn without the handoff file and without a pull request keeps its run open, and the project's queue blocked, for up to twelve hours. | likely; open |

### Found by this session

- Loki's pre-push hook (`.husky/pre-push`) starts a watchdog `( sleep 900; … ) &` and on exit kills the subshell but not its `sleep`, which keeps the caller's output pipe open. `git push | tail` (or any tool that waits for the pipe to close) hangs fifteen minutes after the push has already landed. Seen here at 05:19 UTC.

### Runner version collisions

Every runner change must bump `desktop/package.json` and prepend to `src/config/changelog.ts` (`scripts/test/desktop-release-drift.ts`), so two open runner pull requests always conflict, and each merged one starts a new update hold. A change that can live on the server should, for both reasons.

## Not yet looked at (the investigation died before these)

- Journey B end to end: the bot's turn loop, its Loki tools against Loki's merged endpoints (#1644 #1646 #1648), the Cat's production tests (`live-rehearsal.yml`, `cat-diagnostics.yml`).
- Loki's own chat as the place to say what to build.
- A scripted production canary for journey A (`scripts/test/loki-loop-e2e.ts --dispatch` exists and needs a session minted on the box; no workflow runs it).

## Next action

1. Loki #1678 (changes 4, 5, 6): green, waiting for the sweep. After the
   merge the branch is deleted: `git fetch --prune`, put the branch on
   `origin/main`, and any later change is a new pull request.
2. OrangeCat #1672: follow CI and the sweep. After its deploy, run
   `cat-diagnostics.yml`: `bots.links` names which link fails with which
   status.
3. Bots answer again only when the shared pool has a link with capacity, or
   on a person's own key. Another session was given the chain (10:59 UTC,
   lane `orangecat~ed39e1e1`); look at what it opened before touching
   `src/config/free-vendors.ts` or `provider-catalog.ts`.
4. The box: read `box-usage.yml` run 43209749814 when it ends. Memory at 96%
   is the common cause of the slow sign-up, the 503 window and the runner's
   timeouts. What to do about it is the owner's call (fewer sessions at once
   through `LOKI_AGENT_MAX_OPEN`, a bigger box, or a builder of its own).
5. Then one more `loki-loop-check.yml` run on a project that is free.
