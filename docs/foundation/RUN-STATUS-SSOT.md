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
| `queued` | Queued |
| `working` | Working — **only** if alive bit true; else demote to Needs you / Starting |
| `stuck` / inject-no-generate | Needs you |
| `failed` | Failed or Needs you (cause decides) |
| `needs_verify` | Needs you (Check live / Confirm) |
| `done` | Done |

Inbox groups stay: Needs you = YOU; Under way = MACHINE (Queued|Working only).

## Builder channels

Status SSOT is **channel-agnostic**. “Waiting for cloud builder” vs “this computer” is a **detail** on Queued/Needs you, not a separate status family. Prefer cloud-first always-on Runner as default home; local is override.

## Done when

Walk: Feedback Working ⇔ Terminal shows post-prompt agent output. Inject fail ⇒ Needs you on Feedback and Activity with one CTA — never Working beside a dead inject. Same labels in Terminal rail and Activity.
