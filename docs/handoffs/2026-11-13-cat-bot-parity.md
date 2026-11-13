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

## State at 08:00 UTC

| Capability | Where | State |
| --- | --- | --- |
| QA walk of a live site (`walk_site`) | Loki #1696, OrangeCat #1697 | merged, deployed, **exercised live** |
| A browser of its own for every bot (`use_browser`) | Loki #1697, OrangeCat #1697 | merged, deployed, **exercised live** |
| Pictures in the thread | Loki `lib/bot-shots.ts`, `GET /api/orangecat/shot/[token]` | merged, deployed, exercised live (JPEGs served) |
| Model picker; own rules and time zone; add and correct a memory; library | OrangeCat #1706 (migration `20261113130000`) | merged, deployed 07:25; live rehearsal case 8 running |
| Voice mode | chatkit #89, released as 0.30.0 | merged, published |
| "Talk" in a bot's chat | OrangeCat #1717 | green, waiting for the sweep |
| Connectors (other apps, OAuth per app, MCP client) | — | not started |
| Group avatar; more than one routine per bot; composer chips | — | not started |

### Exercised live: `orangecat-rail-check.yml`, run 43388040356, 07:50 UTC, 15 of 15

From the box, signed with the rail's own secret, as the operator's linked
actor, against https://orangecat.ch:

- an unsigned step, a request an hour old and an actor with no Loki account
  are each refused (401, 401, 409);
- a walk: the home page passes; `/discover` with words that are not there
  fails with its sentence, and its picture is served as a 23 KB JPEG;
- a bot's browser: a click with no page open is said; the home page opens
  with 40 numbered elements and a 39 KB JPEG; a click on "Discover" lands on
  `/discover`; typing "bike" into field 8 and Enter lands on
  `/discover?q=bike`; back goes back; the password field on `/auth` is
  refused; `127.0.0.1` and the metadata address are refused; it closes.

The first run (43387876987) was 14 of 15: the check itself picked the "Open
search" button as the field to type into. Fixed in the check.

What this does not show: a bot's model choosing those steps in a chat. That
needs the owner's account (a linked Loki account and a key of his own), or
the shared pool answering.

### The shared pool does not answer (06:24 UTC, first hand)

A brand-new person's bot on orangecat.ch gets 502 in 0.7 s, "The free AI tier
could not answer just now". `cat-diagnostics.yml` for that hour: google 403
(the Gemini API is off), groq 429, openrouter 429. `live-rehearsal.yml` run
43374705865 failed its bot cases and was cancelled at 30 minutes. The
diagnostics now tell OrangeCat's own daily cap ("cap") from a vendor's 429
(in OrangeCat #1706). Bots answer on a person's own key. The owner's way back
to a free pool: unlink billing from the Gemini key's project and switch the
API on again.

## What holds things up

- **Loki's sweep is rate-limited, on and off.** At 05:49 and again at 06:47 UTC Auto-merge runs on
  Loki ended "API rate limit exceeded for installation" and skips every pull
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

1. OrangeCat #1717 (Talk) through the sweep; then a look at it on a phone is
   the owner's: iOS and Android differ in when a voice may start.
2. Read `live-rehearsal.yml` run 43385608909 (case 8: model, rules, memory,
   library as a new person).
3. Connectors. 4. Group avatar, several routines per bot, composer chips.

## Known limits, said plainly

- A bot's browser runs in a datacenter. Google and some other sites refuse
  sign-in from one, and a bot never types a password, so "do it in my Google
  console" is not something this browser will do.
- On the shared free pool a bot has no model to choose and hands that cost
  nothing extra; the owner's own key is what makes a bot reliable.

## One key, kept in Loki, used on OrangeCat too (2026-11-13)

The owner saved an xAI key in Loki and asked that OrangeCat offer the same key
instead of asking for it again, for the linked account only.

- The key never leaves Loki. `POST /api/orangecat/model` (signed rail, fresh,
  linked account) makes the chat completion at the vendor and returns words.
  Shape and bounds: `src/lib/orangecat-model.ts`; test:
  `scripts/test/orangecat-model-door.ts`.
- Per key switch `user_model_keys.for_orangecat`, off by default. On from Loki
  (Settings → Your model, "Also for your OrangeCat bots") or from OrangeCat
  by the signed-in person (`do: "share"`).
- Never the person's own endpoint (`custom`). 240 calls an hour per account.
- OrangeCat half (the offer in Settings → AI and the model row, and the
  service that calls this door) is the next pull request there.
