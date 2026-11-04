# Idle project session repair — 2026-11-04

The integrated OrangeCat/Loki repair handoff identified that Workbench had no
composer when its project had no session. `TerminalSurface` rendered the box
only for an attached tab. The empty view offered Resume instead, so the task
could not start from the promised box.

The repair reuses `SessionComposer` and its existing ChatKit wrapper. A requested,
registered project gets that box before a session exists, including a project
with only a repository. The authenticated context lists eligible projects;
unknown projects, gated builders, loading state and shells keep their existing
handling. An absent requested session still never attaches to another project.
The normal session poll attaches once the project's session appears. This serves
Workbench and the phone's scoped Sessions destination without a second composer.

A cold task with attachments goes through the existing `tab-inject` startup and
tracked-run path. Live attachments retain `chat-send`. Agent commands require a
running session and keep their draft on refusal. Failed sends keep their words;
accepted work shows its queued lifecycle. Dispatch observations are bound to the
command that produced them, so a new task cannot inherit an older completion.

Focused evidence: project-selection and attachment-isolation assertions; an
actual-component Chromium harness with the product stylesheet at 320/390/1440,
44px send targets, no horizontal overflow, failed-send retry, queued status,
independent successive tasks, idle command refusal, cold attachment routing and
live keystrokes. These use controlled API responses, not a real builder. Full
application gates, release receipt and a deployed idle-to-result journey remain
required before calling this shipped. Independent-account isolation, delivery
contracts, mobile OS keyboard and the wider audit remain open.

## OrangeCat release continuation

OrangeCat PR [#1562](https://github.com/bitbaum/orangecat/pull/1562), source
`3aa2e8f00bdc32acdd11674ed1e38eb65d948bfa`, prevents durable memory/context
tool writes in temporary chats. Normal push gates passed all 5,667 tests. At
17:40 UTC its GitHub-hosted jobs and an older merge sweep were queued without a
runner; deployment was not established. Active implementation moved to the
requested Loki repair while that external release gate waited. Resume by
checking the PR, the automatic merge sweep, deployment and the served receipt;
never merge by hand. The previous OrangeCat #1558 release was independently
confirmed at its public receipt as `0b970d0f181e3e9ebd5fdeb6caf4e7aa659b4122`.
