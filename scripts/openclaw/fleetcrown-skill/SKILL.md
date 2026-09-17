---
name: fleetcrown
description: Command George's FleetCrown fleet from chat — book calendar appointments, dispatch coding tasks to projects, list the approval queue, and approve/reject queued actions. Use when George asks to put something in his calendar, run/dispatch/build something in a project, asks what's waiting for approval, or says approve/reject.
---

# FleetCrown fleet control

FleetCrown is the orchestration layer over George's ~20 repos, and the owner of
his action queue. This skill is the chat seam: book appointments, dispatch work,
see the queue, and decide queued actions — all against the FleetCrown API with
George's own agent token.

All commands go through one wrapper (never call curl yourself — auth and
error shaping live in the script):

```bash
bash /home/openclaw/.openclaw/workspace/skills/fleetcrown/scripts/fc.sh <command> [args]
```

## Put something in George's calendar

```bash
bash .../fc.sh book "Dentist" "2026-09-19T14:00:00+02:00" "2026-09-19T15:00:00+02:00" "Praxis Oerlikon"
bash .../fc.sh book "Flight to Berlin" "2026-10-02"     # bare date = all-day
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
  - `awaiting-approval` — it needs his yes. Say so, and say why if `reason` is
    set (guests on the invitation, or a date you did not resolve). He already
    has one-tap buttons on his phone; do NOT tell him to open the website.
  - `deduped: true` — an identical proposal is already waiting. Say that, and
    do not queue a second one.
- **Guests are different.** An event with other people sends real invitations,
  so it always waits for George. Confirm who is being invited before proposing.

## Dispatch a task to a project

```bash
bash .../fc.sh dispatch <project> "<task>"
```
Sends the task to the project's agent via the Fleet Runner (local machine) or
queues it if the runner is offline (it then auto-falls-back to the hosted
runner when the project has a git URL). The run is tagged notifyOnClose, so
the outcome is pushed to George's Telegram when it finishes — tell George the
dispatch is queued and that the result will arrive as a push; do NOT poll.

## Dispatch to the hosted (cloud) runner explicitly

```bash
bash .../fc.sh hosted <project> "<task>"
```
Clone → agent → PR, independent of the laptop. Use when George says "in the
cloud", or the fleet runner is known offline.

## List the approval queue

```bash
bash .../fc.sh pending
```
Returns the open drafts (id, type, title, reasoning). Summarize them for
George with a short id prefix (first 8 chars) per row.

## Approve or reject a queued action

```bash
bash .../fc.sh decide <id-or-prefix> approve
bash .../fc.sh decide <id-or-prefix> reject
```
Prefix is resolved against the pending list; ambiguous or unknown prefixes
fail loudly — never guess. Approving EXECUTES the action (send, dispatch,
book…). Only decide when George has explicitly said so for that specific
item, and echo back WHAT was approved. If George says "approve all", list
what that means first, then decide each id he confirms.

## Rules

- Never dispatch destructive tasks (deletes, force-pushes, prod data changes)
  without repeating the exact task back to George and getting a yes.
- Project names: use what George says (case-insensitive); on "unknown
  project" errors, relay the knownProjects list from the response.
- On HTTP errors, show the API's error message — do not retry more than once.
- Never say something was booked, sent or done unless the response said so.
  `awaiting-approval` is not done, and `auto-approved` on an event means it is
  being booked — the Telegram confirmation is what proves it landed.
