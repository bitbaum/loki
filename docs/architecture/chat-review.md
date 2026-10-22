# The chat-review loop

Every chat in the fleet is `@bitbaum/chatkit`, and from 0.14 chatkit carries
the two halves of one loop: a thumb under every answer, and the transcript a
product exports so a judge can read a day of its conversations. Loki runs the
judge and files what it finds where fixes get built — its own feedback inbox,
on the Loki project that builds that product. The owner should never again be
the one who discovers that a chat answered "nothing in our database" with no
web lookup and no way forward (2026-10-22, Heidi and Substrata).

## The pieces

| Piece | Where |
|---|---|
| The products in the loop, the night's budgets | `src/config/chat-review.ts` (SSOT) |
| Thumbs under Loki's own answers | `components/loki/AnswerActions.tsx` → chatkit's `AnswerActions` with `onFeedback`; `TerminalLokiRail` and the prompt `RunModal` pass `onFeedback` to `ChatThread` |
| Where a thumb goes | `POST /api/chat/feedback` → `chat_feedback` (`src/db/schema/chat-feedback.ts`); a thumb down is also filed as a report in Loki's inbox (`lib/loki/answer-report-file.ts`, the path the old "Bad answer" button took) |
| What a product exports | `GET /api/chat/review-export?since=&limit=` → `{ product, scope, transcripts: ChatTranscript[] }` |
| Loki's own export | `src/app/api/chat/review-export/route.ts`; the scope is `lokiChatScope()` — the words the model is given, never a second description |
| The judge's words | `src/lib/chat-review/judge.ts`: `CHAT_REVIEW_INSTRUCTION` + `reviewPrompt(scope, transcript)` — chatkit's, unchanged, so every product is judged alike |
| The judge | an agent run on the product's Loki project (`src/lib/chat-review/dispatch.ts` → `injectPrompt`, the path the autopilot night takes to read a live page), carrying `composeChatReviewPrompt` (`prompt.ts`). **This server never calls a model for it**: no box timer may spend the shared free AI tier (`scripts/test/no-free-background-ai.ts`), and the agent is the model the project already pays for |
| The finding | `src/lib/chat-review/finding.ts`: score, gaps, what the person wanted, what we could have given, what we gave, the fix — the shape the prompt tells the agent to write |
| The filing | the agent's own `POST /api/feedback` on the Loki project whose `gitUrl` is the product's repo (`findProjectByRepo`), with its widget token and the reviewer's agent pass (`lib/feedback/agent-pass.ts`), exactly as AI review files a page finding |
| The night | `src/app/api/crons/review-chats/route.ts`, 03:40 UTC (`scripts/install-hetzner-crons.sh`); outcome per product in `debug_logs` under `crons/review-chats` |
| The shared secret | `CHAT_REVIEW_TOKEN`, one value in every app's env on the box; `.github/workflows/share-chat-review-token.yml` puts it there and redeploys |

## The night, in order

1. For each product in `CHAT_REVIEW_PRODUCTS`, fetch its export with the
   shared bearer: conversations updated in the last 24 hours, newest first,
   at most `REVIEW_MAX_TRANSCRIPTS_PER_PRODUCT` (30), never a temporary chat.
   Each transcript holds at most 30 turns of ≤ 4000 characters, the steps the
   assistant took when the product stored them, which turns failed, and the
   thumbs the person gave. Ids are the product's own; no names, no user ids.
2. Start one agent run on the product's Loki project (as its owner) with the
   judge's input for every conversation: strictly, from the person's side,
   what they most likely wanted, what the product could have given with the
   tools its scope names, and what it gave; a score 1–5 and the gaps from
   `REVIEW_GAPS` (dead end, wrong tool, no web lookup, misread, vague, no next
   step…), and one concrete fix. A day too long for one prompt is cut by
   whole conversations and the prompt says how many were left out.
3. The agent files a review with a score under `REVIEW_FILE_BELOW_SCORE`
   (4), or naming any gap, as a finding — the worst first, at most
   `REVIEW_MAX_FINDINGS_PER_PRODUCT` (8) per product per night, the same gap
   once; the ingest bumps a repeat of an open row as a duplicate.
4. A finding is a visitor-shaped report on the product's Loki project,
   `source: ai_review` (proven by the agent pass), `contact: "Loki chat
   reviewer"`, page = the transcript's surface. From there it is what every
   finding is: triaged in `/feedback`, built by the autopilot night, verified
   on the live site.

A product that cannot be read or reviewed (export refused, token unset,
nothing with an answer, no Loki project links its repository, no active
widget token, the dispatch refused) is skipped and the skip is logged with
its reason under `crons/review-chats` — the night never fails on one product.

## What a product owes the loop

- `POST /api/chat/feedback` taking `{conversationId, messageId, verdict,
  reason?, text?}` from chatkit's `onFeedback`, kept in a `chat_feedback`
  table.
- `GET /api/chat/review-export` behind `Authorization: Bearer
  $CHAT_REVIEW_TOKEN` (constant-time compare; 401 otherwise; 503 while unset),
  answering the shape above, with a `scope` derived from its own assistant
  prompt or tool config — 3–6 sentences on what the assistant can do, its
  data and its limits — never typed a second time by hand.
- `CHAT_REVIEW_TOKEN` in its `.env.example` and one paragraph in its docs.

## Pinned

`scripts/test/chat-review.ts` (transcript shape, the judge's input, the
agent's prompt and its budget, the finding text, the night's ordering). The
cron ratchets (`cron-schedule-coverage`, `cron-outcome-persistence`,
`no-free-background-ai`) keep the timer, the log line, and the rule that the
night calls no model; `api-route-auth` names the export's guard.
