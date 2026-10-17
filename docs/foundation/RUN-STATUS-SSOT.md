# Run status SSOT (all surfaces)

Cato 2026-09-17: one canonical status language for **Feedback, Terminal, Activity, Watch, Chat** — and any future surface. No second “is it alive?” bit per panel. Dual local/cloud Runner must not invent different status vocabularies.

## The six statuses (operator-facing)

| Status | Meaning | Who acts | May show as Working? |
|--------|---------|----------|----------------------|
| **Queued** | Job is on a builder queue, not claimed yet | Machine (wait) | No |
| **Starting** | Claimed; PTY up; prompt submitted or about to be; **not** yet generating | Machine | No |
| **Working** | Post-prompt evidence the agent is **actually generating** (one alive bit) | Machine | Yes — only this |
| **Needs you** | Blocked: inject-no-generate, quota, login, Runner offline, trust dialog | You — one CTA | No |
| **Done** | Finished with evidence (PR / explicit no-change / live confirm) | Nobody | No |
| **Failed** | Run ended dead; cause recorded | You — Retry or switch | No |

`STUCK` in code maps to **Needs you** in the UI (same waitingOn=YOU), unless it is a pure timeout with a clear Retry CTA — still not “Working.”

## The one alive bit

**Working ⇔** post-prompt PTY/Terminal frames show generation (not boot redraw, not a progress timer alone).

Every surface **reads** `work.phase` (and the same run id). They do not re-derive Working from:

- progress heartbeats alone,
- peek SSE connected with no frames,
- Activity rows from a *previous* Failed run.

## Mapping (code today → SSOT)

| Code phase (`work-phase`) | SSOT label |
|---------------------------|------------|
| `not_started` | (no status chip — Implement) |
| `queued` | Queued / Starting (badge label) |
| `working` | Working — **only** if alive bit true; else demote to Needs you / Starting |
| `stuck` / inject-no-generate | Needs you |
| `failed` | Failed or Needs you (cause decides) |
| `needs_verify` | Needs you (Check live / Confirm) |
| `done` | Done |

Inbox groups stay: Needs you = YOU; Under way = MACHINE (Queued|Working only).

## The delivery track (Watch)

Status answers "is it alive?". It does not answer the question the person who
sent the change is asking — "is it going to appear on my site, and where is
it now?" — and on 2026-10-17 an owner watching a healthy run ("Claude Code is
working · started just now", a narrated headline) did not believe it, while
GitHub already held the branch and the pull request.

So Watch also draws the **delivery track** (`lib/run-track`, pure; rendered by
`components/projects/RunTrack`): six fixed stages, each one done / now / next /
needs you / failed, with one sentence for the whole:

| Stage | Done on | Never on |
|---|---|---|
| You asked | the run exists | — |
| A builder picked it up | a `claimed` / `launched` / `submitted` / `generating` event | time passing |
| The agent made the change | a `generating`/`progress` event, then a push or PR | the narrated headline |
| Pull request opened | the PR seen on GitHub (`payload.evidence`, found while the run is live by `lib/run-evidence-live`, or the fix ledger) | the handoff's prose alone |
| Checks passed and merged | the fix ledger's `merged`/`deploying`/`deployed` | — |
| Live on `<site>` | the fix ledger's `deployed`, with Loki's look under it | a green CI check |

Every stage carries `at` (when it happened or began) and `facts` (which
builder, which pull request, which deploy run, what Loki saw); the page turns
the whens into "took 1m 20s" per stage and a one-second clock on the stage
happening now (`stageTimings`), and a tap on a row opens its facts — for the
working stage, the agent's screen as Watch last saw it. After the run, the
same card plays the pull request's Walkthrough (`lib/feedback/fix-note`, now
asked of every project dispatch too, not only visitor fixes).

The route (`/api/projects/[id]/watch`) carries `track`, `following` and `walkthrough`; the
page polls every 10 s after the run closes until the track settles (live and
looked at, closed without merging, or nothing reached GitHub), and not after.
A stage is never claimed on the clock: "merged" means GitHub said so.

## Builder channels

Status SSOT is **channel-agnostic**. “Waiting for cloud builder” vs “this computer” is a **detail** on Queued/Needs you, not a separate status family. Prefer cloud-first always-on Runner as default home; local is override for laptop-locked projects.

## Done when

Walk: Feedback Working ⇔ Terminal shows post-prompt agent output. Inject fail ⇒ Needs you on Feedback and Activity with one CTA — never Working beside a dead inject. Same labels in Terminal rail and Activity.
