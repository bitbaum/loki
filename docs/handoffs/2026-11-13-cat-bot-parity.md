# Cat Bot: a complete equivalent of Grok Bot (started 2026-11-13)

The owner ran out of Grok Bot and wants his own: "a complete equivalent to
GrokBot … it should actually be better. … test everything, and don't stop
until everything is done." This file is the running checkpoint for that work,
so another session can pick it up. The day before is
[2026-11-12-build-with-loki-and-cat.md](2026-11-12-build-with-loki-and-cat.md).

The scorecard is OrangeCat `docs/PARITY.md`; the reference is OrangeCat
`docs/research/grok-bot/README.md` (94 screenshots, 2026-10-30). A row is
**built** only when its pull request is merged; **exercised** only when it was
used on the live site.

## State at 06:10 UTC

| Capability | Where | State |
| --- | --- | --- |
| QA walk of a live site (`walk_site`) | Loki #1696 merged, live 05:22 (unsigned POST answers 401). OrangeCat #1697 open, green. | Loki half deployed; hand not merged |
| A browser of its own for every bot (`use_browser`) | Loki #1697 open, green. OrangeCat #1697 (same PR as the walk). | not merged |
| Pictures in the thread | Loki `lib/bot-shots.ts`, `GET /api/orangecat/shot/[token]` (in Loki #1697) | not merged |
| Model picker | OrangeCat, local branch only | written, tested, not pushed |
| Add and correct a memory | OrangeCat, local branch only | written, tested, not pushed |
| Library (photos, files, links of a chat) | OrangeCat, local branch only | written, tested, not pushed |
| Own rules checked before a bot acts on its own; time zone | OrangeCat, local branch only (migration `20261113130000`) | written, tested, not pushed |
| Live rehearsal case 8 (model, rules, memory, library) | OrangeCat `tests/e2e/bots-rehearsal.live.spec.ts`, local | written, not run |
| Voice mode (calls, server speech, push-to-talk) | — | not started; dictation and "Listen" exist |
| Connectors (other apps, OAuth per app, MCP client) | — | not started |
| Group avatar; more than one routine per bot; composer chips | — | not started |

The OrangeCat work after #1697 sits on a local branch because each repository
has one working branch (`ccr-6043476f-vhm900`) and it is held by the open
pull request. It is pushed as the next pull request the moment #1697 merges.
Unit suite with all of it: 734 files, 5958 tests.

## What holds things up

- **Loki's sweep is rate-limited.** Since 05:49 UTC every Auto-merge run on
  Loki ends "API rate limit exceeded for installation" and skips every pull
  request as "outside PR (UNKNOWN". Loki has about thirty open pull requests
  (fifteen `starter-sync/*`), and each sweep reads each one. It lifts when the
  hour's window resets; a push or a CI completion starts the next sweep. Do
  not dispatch the sweep by hand: it spends the same budget.
- OrangeCat's sweep runs on CI completion and hourly at :41.

## How it is built (so the next piece fits)

- **One rail.** Everything a bot does outside OrangeCat goes over the signed
  OrangeCat → Loki rail (`ORANGECAT_WEBHOOK_SECRET`, `readSignedOrangeCatBody`,
  `isFreshIssuedAt`, the Loki account linked to the actor). A new door is a
  route under `src/app/api/orangecat/` in Loki and a function in OrangeCat
  `src/services/loki/`, registered once in `LOKI_HANDS`.
- **One browser.** Loki's Chromium on the box (`lib/feedback/page-picture`):
  `serverChromium()` and `privateNetworkGuard()`. The walk uses the queued
  `withLivePage`; a bot's browser (`lib/bot-browser.ts`) keeps a session per
  (account, bot), two at once, three idle minutes, cookies in
  `LOKI_BOT_BROWSER_DIR`. A function sent into a page is a **string**
  (`PAGE_READER`): a bundler renames inner functions and the page then reads
  as empty with no error.
- **Bounds.** A bot never types a password, a sign-in code or a card
  (`lib/bot-browser-rules.ts refusalForField`). The owner's own rules can only
  add a tap (`OrangeCat services/companions/rules.ts`).
- **A new hand in OrangeCat** touches: `config/cat-actions.ts`,
  `config/cat-connections.ts`, `config/companions.ts` (label),
  `services/companions/hands.ts` (`COMPANION_HANDS`), `hand-rows.ts` (if it
  only reads), `services/cat/action-descriptions.ts`,
  `services/cat/handlers/`, `lib/chat/tool-labels.ts` (the verb),
  `.env.example` (any override), and three tests that pin lists and the
  prompt budget (`hands.test`, `work-loop.test`, `prompt-sections.test`).
- **No GET may import what can reach a model**
  (`__tests__/unit/ci/no-background-ai`): a write that embeds or calls a model
  gets its own route file.

## Next, in order

1. When OrangeCat #1697 merges: push the local branch as the next pull
   request; when deployed, run `live-rehearsal.yml` (case 8 is new).
2. When Loki #1697 is deployed: as the owner's account, a bot with
   `use_browser` and `walk_site` on the live site; record what the thread
   shows.
3. Voice mode. 4. Connectors. 5. Group avatar, several routines per bot.

## Known limits, said plainly

- A bot's browser runs in a datacenter. Google and some other sites refuse
  sign-in from one, and a bot never types a password, so "do it in my Google
  console" is not something this browser will do.
- On the shared free pool a bot has no model to choose and hands that cost
  nothing extra; the owner's own key is what makes a bot reliable.
