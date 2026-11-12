# Feedback → implementation production walk

This is the release gate for Loki's core loop. A status badge alone does not pass.

## Expected path

1. A visitor leaves feedback through the site widget.
2. The operator opens **Feedback** and clicks **Implement**.
3. The row immediately opens **Watch** and keeps visible links to **Terminal** and **Chat**.
4. Loki routes the run to the project's stored builder and AI provider.
5. The builder owns a PTY, prepares first-run trust, submits the prompt, and reports post-submit output.
6. Watch changes from **Queued** to **Working** only after the Runner reports delivery and output.
7. Terminal streams the same PTY by run/project identity. Chat retains the same project context.
8. Completion requires evidence: a green PR for code work, or an explicit no-change result for a probe.

## Failure contract

Every stop must show all three:

- **What failed:** builder, workspace, authentication, provider response, verification, CI, or deploy.
- **Why Loki believes that:** the observed event or terminal state.
- **What to do next:** one primary action, such as open Fleet Runner, log in, switch provider, open Terminal, or retry.

Do not use “Failed — Retry” when the required action is different. Do not call a run Working from a timer or from PTY boot output.

## Production test

Use a harmless, identifiable feedback row. Set a provider that passes a live probe on the selected builder. Click through the browser, then verify:

- the path strip survives the inbox refresh;
- Watch, Terminal, and Chat are reachable without navigating elsewhere;
- Watch says Working while Terminal shows post-prompt agent output;
- the run ledger and PTY agree on provider, builder, and outcome;
- the resulting PR/check/deploy evidence returns to the row.

Record the tested production commit and any failure cause in the handoff. If any check fails, fix and repeat this same walk.

## Agent walk

The same loop, filed by a machine. `node scripts/walk/agent-walk.mjs` files one
harmless report, polls its `statusUrl` and prints each canonical state
(Queued, Starting, Working, Needs you, Done, Failed) until Done or Failed.
Exit 0 Done, 1 Failed, 2 Needs you or out of time, 3 could not file.
`scripts/test/agent-walk.ts` pins it against a fake server.

Environment (the token comes from the environment only and is never printed;
the script also refuses to send it to an origin other than `LOKI_URL`):

| Variable | Meaning |
| --- | --- |
| `LOKI_SEAT_TOKEN` | `ck_…` token of the agent's own seat, not the owner's |
| `LOKI_PROJECT_ID` | the project the seat belongs to |
| `LOKI_URL` | origin of Loki (default `https://loki.orangecat.ch`) |
| `LOKI_AGENT_NAME` | inbox label (default `QA · quality control`) |
| `LOKI_WALK_TIMEOUT_S` | stop polling after this long (default 600) |

### The filing contract

Handing a QA bot a seat: the project's owner gives the bot's own account a
Viewer or Reporter seat (never Owner or Editor), and the bot mints its token
at `POST /api/agent-tokens` with its own session. Any seat may file.

A person's OrangeCat bot files through the same contract without a seat token
of its own: `POST /api/orangecat/feedback` on the signed OrangeCat rail files
as the Loki account linked to that person, with `{actorId, issuedAt, project
(by name), suggestion, agentName, idempotencyKey?, page?, url?, pageTitle?}`
(words only, no attachments), and reads a report back with `{actorId,
issuedAt, feedbackId}`. Both doors call one body (`lib/feedback/agent-filing`),
so the answers, the replay rule and the limit below are the same.

1. **File.** `POST /api/projects/<id>/feedback` with
   `Authorization: Bearer ck_…`, JSON
   `{suggestion (1–2000), agentName (1–80, e.g. "QA · quality control"), idempotencyKey? (8–200), page?, url?, pageTitle?, screenshots?, context?, moments?, selectedElements?}`.
   Answer `201 {id, status, statusUrl, replayed: false}`; the same
   `idempotencyKey` again answers `200` with the same `id` and `replayed: true`,
   so a retry never files twice. 60 filings per seat per project per window,
   then `429`. `401` no valid token, `404` the token's user has no seat here.
2. **Does it build?** Not unless the project's owner opted in. The owner's
   `agentBuildsUnasked` switch (`PATCH /api/projects/<id>/build-grants`, session,
   owner only) is off by default; off, the report waits for a tap. On, the
   filing answer also carries `{building, buildNote}`. The bot never dispatches.
   `statusUrl` is built from the server's `NEXTAUTH_URL` (else `APP_URL`). The
   walk sends the token only to the origin in `LOKI_URL`, so `statusUrl` must
   share that origin: if it does not, the walk stops with exit 3 before polling.
   Set `LOKI_URL` to the same origin the server is configured with.
3. **Poll.** `GET <statusUrl>` (`/api/feedback/<id>/status`) with the same
   Bearer token, `Cache-Control: no-store`. A non-owner seat gets
   `{id, source, state, label, cause, reason, nextAction}` for a report it filed
   (on Needs you the reason and next step are never empty: a filed, unstarted
   report is `awaiting_implement`, "nothing to do, the owner decides"; no
   request, no evidence; a closed report, `closed_without_change` or
   `done_unproven`, says nobody is acting on it: `nextAction.kind` is `none`,
   so stop polling); another seat's report is
   `404`. Owner and editor seats get the whole status: `cause`, `reason`,
   `nextAction` (with the exact `request` when there is one) and `evidence`.
4. **Read the state.** `state` is one of `queued starting working needs_you
   done failed`. **Done** is earned: a pull request, its merge, a deploy and a
   live URL; otherwise `needs_you` with cause `done_unproven`. Closed without a
   change is `failed`. See RUN-STATUS-SSOT.

Never put a token in an argument, a log line, a report or a commit.

## Session walk

An agent drives a project's coding agent (Claude Code when that is the
project's agent) in a Loki session on the project's builder, the always-on
cloud builder unless the project is set to another, and the owner opens the
same session in Loki on any device. Every call takes a `ck_` token of the
account the builder belongs to, as `Authorization: Bearer`; a token only ever
reaches its own account's sessions.

1. **Start or continue.** `POST /api/control/tab-inject` `{tab, prompt}`, where
   `tab` is the project's name. A session that is running gets the prompt
   typed into it; otherwise the builder starts the project's agent and hands
   it the prompt. Returns `commandId` and `runId`.
2. **See it is up.** `GET /api/control/open-tabs?channel=cloud` lists the
   sessions open on the cloud builder, by name.
3. **Read it.** `POST /api/control/peek-tab` `{tab, channel: "cloud"}` returns
   `resultUrl` and `openUrl`. `GET <resultUrl>` is `pending`, then `done` with
   `content` (the session's terminal output so far) or `error`. Ask again for
   a newer capture.
4. **Type a key or a command.** `POST /api/control/tab-inject-raw`
   `{kind: "key", tab, data, channel: "cloud"}`, the bytes the Terminal page
   sends for a keystroke.
5. **Close it.** `POST /api/control/close-tab` `{tab, channel: "cloud"}`.
6. **Hand it to a person.** `openUrl` (`/terminal?project=<tab>`) is the same
   session in Loki's Terminal, for whoever is signed in as the owner, on a
   phone or a computer.

A plain shell (`loki-shell-…`) is never part of this: its screen and keys
belong to a signed-in, unlocked browser, and a token gets `403` or `404`.
`scripts/test/agent-session-read.ts` pins the read side.
