# Build with Loki and with a Cat bot — checkpoint, 2026-11-12

One queue for work that spans `bitbaum/loki` and `bitbaum/orangecat`. Any agent
can continue from this file without the chat that started it. OrangeCat's own
record points here: `orangecat/docs/development/2026-11-12-cat-bot-build-handoff.md`.

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
| 06:10–07:00 | Wrote the fix (below) on `ccr-6043476f-vhm900` | checked locally: `tsc`, eslint on the changed files, `scripts/test/runner-update-hold.ts` and the eleven tests that read the changed files. `test:ops` stops at `test-host-alerts.sh` with 4 failures that an untouched tree shows too in this sandbox. Full `verify` is CI's. |

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

1. Open the pull request for change 1, follow it through the sweep and the
   deploy, then prove it on production: `loki-loop-check.yml` with
   `dispatch=true`, and `sealed-builds.yml` `mode=journal` to see a
   `claimed dispatch` line.
2. `sealed-builds.yml` `mode=activity`, then the drain's rule.
3. Journey B: read the bot's Loki tools against Loki's merged endpoints, run
   OrangeCat's `live-rehearsal.yml` / `cat-diagnostics.yml`, fix what stops a
   bot from sending a task and reading it back.
