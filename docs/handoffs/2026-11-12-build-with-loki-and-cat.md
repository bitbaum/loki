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
| 05:20 | Started a ten-way read-only investigation of both journeys (dispatch path, run to shipped, Loki's chat, the cloud builder, open pull requests, a scripted production test, the bot turn loop, the bot's Loki rail, parity with Grok Bot, the Cat's production tests, a public probe) | running |

## Findings

Filled in from the investigation; see the sections added below this line.

## Next action

Read the investigation's result, pick the smallest set of changes that makes
journey A work in production, ship them from branch `ccr-6043476f-vhm900`, then
journey B.
