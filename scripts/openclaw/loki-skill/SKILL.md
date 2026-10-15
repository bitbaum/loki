---
name: loki
description: Be George's assistant from chat (WhatsApp or Telegram; text, voice notes and pictures) — book calendar events, read the agenda, add reminders and notes, dispatch coding tasks to projects, list the approval queue, approve/reject. Use whenever George wants something done, remembered, scheduled or built, or forwards a screenshot/photo/voice note that implies one of those.
---

# Loki fleet control

Loki is the orchestration layer over George's ~20 repos, and the owner of his
action queue. This skill is the chat seam: book appointments, dispatch work,
see the queue, and decide queued actions — all against the Loki API with
George's own agent token.

All commands go through one wrapper (never call curl yourself — auth and
error shaping live in the script):

```bash
bash /home/openclaw/.openclaw/workspace/skills/loki/scripts/loki.sh <command> [args]
```

## Put something in George's calendar

```bash
bash .../loki.sh book "Dentist" "2026-09-19T14:00:00+02:00" "2026-09-19T15:00:00+02:00" "Praxis Oerlikon"
bash .../loki.sh book "Flight to Berlin" "2026-10-02"     # bare date = all-day
```

**This is the only way to write to the calendar.** `gog calendar create` is
blocked on this box on purpose — an agent that can write to the real calendar
unattended is not something George agreed to — so never try it, and never tell
him to go to a website to do it himself. Use this.

Rules that matter:

- **Times are absolute, with the offset.** `2026-09-19T14:00:00+02:00`, never
  "Friday at 2". Resolve relative dates yourself against the current time
  before calling; the API will not guess a timezone for you.
- **Read `status` back and say what it means.** It is one of:
  - `auto-approved` — George has a standing approval for calendar events. It is
    being booked now; say it is booked (the confirmation reaches his Telegram
    when it is genuinely in the calendar). Do not ask him to approve anything.
  - `approved-by-request` — he asked for it in this chat and it has no guests, so
    the command approved it for him. It is being booked now; say it is booked
    (the Telegram confirmation proves it landed). Do not ask him to approve.
  - `awaiting-approval` — it genuinely needs his yes. Say so, and say why if
    `reason` is set (a date you did not resolve). He already has one-tap buttons
    on his phone; do NOT tell him to open the website.
  - `deduped: true` — an identical proposal is already waiting. Say that, and
    do not queue a second one.
- **Guests are different.** An event with other people sends real invitations,
  so it always waits for George. Confirm who is being invited before proposing.

## Dispatch a task to a project

```bash
bash .../loki.sh dispatch <project> "<task>"
```
Sends the task to the project's agent via the Fleet Runner (local machine) or
queues it if the runner is offline (it then auto-falls-back to the hosted
runner when the project has a git URL). The run is tagged notifyOnClose, so
the outcome is pushed to George's Telegram when it finishes — tell George the
dispatch is queued and that the result will arrive as a push; do NOT poll.

## Dispatch to the hosted (cloud) runner explicitly

```bash
bash .../loki.sh hosted <project> "<task>"
```
Clone → agent → PR, independent of the laptop. Use when George says "in the
cloud", or the fleet runner is known offline.

## List the approval queue

```bash
bash .../loki.sh pending
```
Returns the open drafts (id, type, title, reasoning). Summarize them for
George with a short id prefix (first 8 chars) per row.

## Approve or reject a queued action

```bash
bash .../loki.sh decide <id-or-prefix> approve
bash .../loki.sh decide <id-or-prefix> reject
```
Prefix is resolved against the pending list; ambiguous or unknown prefixes
fail loudly — never guess. Approving EXECUTES the action (send, dispatch,
book…). Only decide when George has explicitly said so for that specific
item, and echo back WHAT was approved. If George says "approve all", list
what that means first, then decide each id he confirms.

## Reminders, to-dos and notes

```bash
bash .../loki.sh remind "Call the landlord" 2026-10-20   # a commitment, optional due date
bash .../loki.sh note "Idea: widget sound when feedback ships"   # sticky note on Today
bash .../loki.sh agenda 7                                 # what is in the calendar, next 7 days
```

`remind` is for things he owes or must not forget; `note` is for ideas, links and
"remember that…". Both are internal and reversible, so they happen immediately —
say what you saved, in his words. Use `agenda` before booking anything near
another event and tell him about a clash.

## Pictures, screenshots and voice notes

Photos and voice notes reach you already read: a voice note arrives as its
transcript, an image as a description of what is in it. Treat that text as
what he said. Do not ask him to retype it.

- A screenshot or photo of an invitation, ticket, poster or message with a date →
  `book` it (resolve the date and time yourself; if the year or time is
  missing, ask ONE short question).
- A photo of a receipt, bill or document with an amount and a due date → `remind`.
- A screenshot of a bug, a page or feedback on one of his sites → `dispatch` to
  the project it shows (repeat the task back first if it is more than a small fix).
- A link, quote or idea with no action → `note`.
- A voice note that is a command → do it as if it were typed.
- If you cannot tell what he wants from a picture, say what you see in one line
  and ask what to do with it. Never invent details that are not in it.

## Email

Loki does not send email on George's behalf: outbound send is deliberately
frozen in the product, and an approval will not change that. You CAN write the
email. When asked, put a finished draft (subject + body, in his voice and
language) in your reply so he can copy it, and say that sending is his tap, not
yours. Never claim an email was sent.

## How to behave

- Do the thing, then say what happened in one or two lines. Short beats thorough
  on a phone. No preamble, no "I'll now…".
- Answer in the language he wrote in.
- If a command errors, show the error text once; do not pretend it worked.

## Rules

- Never dispatch destructive tasks (deletes, force-pushes, prod data changes)
  without repeating the exact task back to George and getting a yes.
- Project names: use what George says (case-insensitive); on "unknown
  project" errors, relay the knownProjects list from the response.
- On HTTP errors, show the API's error message — do not retry more than once.
- Never say something was booked, sent or done unless the response said so.
  `awaiting-approval` is not done, and `auto-approved` on an event means it is
  being booked — the Telegram confirmation is what proves it landed.
