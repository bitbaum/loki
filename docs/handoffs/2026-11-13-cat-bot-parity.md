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
- `complete` carries function definitions in the vendor's native tool format
  and returns the calls the model asked for; OrangeCat runs them, Loki runs
  none. This is what lets a bot use tools the way its model was trained to.
- OrangeCat half (the offer in Settings → AI and the model row, and the
  service that calls this door) is the next pull request there.

## Talk is held by the rollout gate (2026-11-13 10:40 UTC)

OrangeCat #1717 was green and did not merge: the sweep's shared-package
rollout gate holds any pull request that bumps `@bitbaum/chatkit` until the
canaries (bitbaum/kivvi and bitbaum/causius) have deployed that version. The
Talk button needs chatkit 0.30.0, so it was taken off that pull request
(two revert commits) and the pull request now carries only the key held in
Loki and native tool calls.

To bring Talk back once kivvi and causius run chatkit 0.30.0: on the OrangeCat
branch, `git revert` the two revert commits ("Revert chore(deps): chatkit
0.30.0" and "Revert feat(companions): Talk"), run `pnpm install`, verify, open
a pull request.

## State when this session handed over (2026-11-13 11:15 UTC)

Live:

- Loki #1703: `POST /api/orangecat/model` (keys, share, models, complete with
  native tool calls). Deployed; refuses unsigned requests.
- OrangeCat #1717 (deployed 11:07 UTC): a key held in Loki answers the
  person's bots (Settings → AI, "Use my <provider> key here"), and on the
  person's own key each model gets its tools in its native format
  (`src/config/model-profiles.ts`, `src/services/companions/native-tools.ts`,
  `src/services/ai/direct-reply.ts`), with a prose retry when a provider
  refuses them.
- Checked live as a new person at 390px: Settings → AI opens with no page
  errors; no offer without a Loki account; a share request without a Loki
  account is refused with Loki's own sentence (so the signed rail works in
  production); models route answers "pool".

Not proven yet:

- A bot answering on the owner's xAI key. It needs the owner's account: tap
  "Use my xAI key here" in Settings → AI, then message a bot. The xAI balance
  may be exhausted (Grok Build was, on the builder).
- Three real jobs on Grok, end to end: walk a site and file a finding; send a
  build task to Loki and report the answer; a routine on schedule. This is the
  test that decides parity.

Talk: causius is already on chatkit 0.31.2 (Messenger work, another session),
so 0.30.0 will never be the canary version. Bring Talk back on top of
whichever chatkit bump lands on OrangeCat: re-apply only the Talk commit
(OrangeCat `453234806`), not the 0.30.0 bump.

The owner's plan for the plumbing, in order (agreed 2026-11-13):

1. A profile per model (done for native tools; prompt shape, limits and vision
   still to add; not yet on the shared free pool or the Cat's own chat).
2. A test bench: the same real tasks on each model, scored on done or not,
   time and cost.
3. Cost in the chat: per answer, and next to each model in the picker.
4. Switching by asking ("use Claude for this"), and the chat suggesting a
   switch when a task is too hard or a cheaper model would do.
5. Auto mode that picks by task and price from the bench results.

Remaining parity gaps: connectors (none built; default first targets GitHub
and Google mail and calendar unless the owner says otherwise), several
routines per bot, group avatar, suggestion chips, voice (Talk, above).

Open questions for the owner: Google billing for the Gemini key; Grok Build
top-up or move the builder to Claude Code; whether to close the stale
`starter-sync/*` pull requests on Loki (not closed).
