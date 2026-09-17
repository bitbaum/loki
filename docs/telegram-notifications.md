# Telegram notifications — the registry

**This file is the SSOT for everything that reaches the operator's Telegram.**
If something pings the phone and is not listed here, that is a bug — and CI
enforces it: `scripts/ci/check-telegram-registry.sh` fails when a file in this
repo sends to Telegram (directly, via `telegram-send.ts`, or via the box's
`lib-alert.sh`) without being registered below. Adding a notification =
adding it here in the same PR. Removing one = removing its row.

The channel's contract (PR #443/#444): **a message is worth sending only if
the operator must act on it, wants the outcome, or asked for the digest.**
One incident is one message; reminders back off (30m → 2h → 8h → daily);
recoveries name subjects, never keys; N events on one tick digest into one
message; test runs (`ALERT_DRY_RUN=1`) never deliver.

## Requested updates (the operator asked for these — keep them)

| What arrives | Trigger | Source |
|---|---|---|
| 📨 New visitor feedback (project, excerpt, link to inbox) | A genuine visitor submits the feedback form (`POST /api/feedback`; AI/synthesizer filings stay silent) | `src/lib/feedback/notify-new.ts` |
| ✅ A fix reached the live site, or 🚨 a merged fix failed to deploy (project, the visitor's words, the pull request, the live page) | The fix ledger sees a run's pull request TRANSITION into deployed or deploy-failed while the inbox is read — once per fix, never on re-reads. Says when Loki merged it automatically, because that is the fact an operator needs to keep trusting the switch | `src/lib/feedback/notify-shipped.ts` |
| 🧾 Waitlist signup / 📬 New subscriber (source, address) | Someone joins a list via `POST /api/newsletter` — the studio site's `/hire/` waitlist sends `source: bitbaum-hire`. Only a genuinely NEW row announces; a repeat signup stays silent. The operator must act on it: the page promises a human writes back when capacity opens | `src/lib/newsletter/notify-signup.ts` |
| Run outcome: what an agent run concluded (root cause → action → remains) | An orchestration run with `notifyOnClose` closes — includes every incident-dispatch remediation run | `src/lib/orchestration/notify-close.ts`, `src/lib/orchestration/gate-and-close.ts` |
| Morning brief, evening wrap, weekly reflection, Monday digest, email deadlines, financial scan, life scorecard | Loki's scheduled jobs — schedules live in their own SSOT: `/home/openclaw/.openclaw/cron/jobs.json` on bitbaum (edit via Loki, not here) | off-repo: OpenClaw cron |

## Incidents (something is broken; a fix agent is already dispatched)

| What arrives | Trigger | Source |
|---|---|---|
| 🔴 DOWN: \<unit\> — \<app error\> → 🤖 fix agent dispatched | A systemd unit fails and stays failed past the grace window | `scripts/hetzner/install-host-alerts.sh` (notify-failure.sh) |
| ⚙️ STILL FAILING: a; b (digest) / ✅ RECOVERED: a; b (digest) | The 5-min sweep sees a unit failed on two consecutive ticks / recover | `scripts/hetzner/install-host-alerts.sh` (host-check.sh) |
| 🔧 FIXED (no action needed): \<what was repaired\> | host-check auto-repaired an unreadable app `.env` and restarted the app | `scripts/hetzner/install-host-alerts.sh` (host-check.sh) |
| 💾 DISK / 🧠 MEM / 🐘 POSTGRES transitions | Resource crosses its hysteresis band on the box | `scripts/hetzner/install-host-alerts.sh` (host-check.sh) |
| 🔴 DOWN: \<app\> (\<url\>) → HTTP \<code\> / ✅ RECOVERED (on-box) | An app URL in targets.conf stops answering | `scripts/hetzner/install-watchdog.sh` (watch.sh; also the external dead-man's-switch ping) |
| 🔴 DOWN: \<app\> (\<detail\>) / ✅ RECOVERED: \<app\> (off-box) | GitHub-side health sweep of every registered app — still reports when bitbaum itself is dead | `.github/workflows/fleet-uptime.yml` (probe: `scripts/hetzner/uptime-sweep.sh`) |
| 🚨 Loki deploy: \<failure/rollback\> | A loki deploy fails or rolls back | `scripts/deploy-hetzner.sh` |
| 🧩 \<app\>: \<runtime conformance finding\> | Deployed reality diverges from the register (wrong port, dead tunnel, inactive unit) | `scripts/hetzner/install-runtime-conformance.sh` |
| 🧪 \<provider/model\>: \<n\> failure(s) in 24h | A model link keeps failing while the fallback chain hides it — Groq answered 400 to every structured Cat call for days and nothing said so | `scripts/hetzner/ai-provider-check.sh` (installed by `scripts/hetzner/install-ai-provider-watch.sh`) |
| 🧪 loki e2e FAILED: … / ✅ RECOVERED | Six-hourly end-to-end check of the live site as the operator: fleet question answered from the map, map published, dispatch returns to its thread (when the builder is authenticated) | `scripts/hetzner/loki-e2e-check.sh` (installed by `scripts/hetzner/install-loki-e2e-watch.sh`; test: `scripts/test/loki-loop-e2e.ts`) |
| 🔑 builder auth DISABLED / 🔌 builder probe got no answer / ✅ RECOVERED | Hourly probe runs Claude Code with the box-runner’s own token; the token dies with the Claude account that minted it and every dispatch then hangs silently (2026-09-14) | `scripts/hetzner/builder-auth-check.sh` (installed by `scripts/hetzner/install-builder-auth-watch.sh`) |
| 🚫/🧟 agent-work findings | Hourly sweep finds stranded/zombie agent work on the box | `scripts/hetzner/agent-work-check.sh` (installed by `scripts/hetzner/install-agent-work-watch.sh`) |
| 🧹/🚨 DISK GC non-routine outcome | GC ran but the disk is still above the warn mark, or nothing was reclaimable (routine success is journal-only) | `scripts/hetzner/install-disk-gc.sh` |
| Fleet refs audit findings | Deployed refs diverge from expected across the fleet | `scripts/hetzner/install-fleet-refs-audit.sh` |
| ✗ register check findings | Daily 09:15 (laptop): committed apps.conf register vs reality — at most one message per finding per day | `scripts/local/fleet-register-check` |

## Threat detection (something changed that only an operator can judge)

Baselines are seeded silently on the first run; every row below fires on
CHANGE only and ends with what to do. Blocking a web scanner is a response,
not a message (fail2ban `caddy-scan`, journal only).

| What arrives | Trigger | Source |
|---|---|---|
| 🧱 FIREWALL DOWN / 🛡️ GUARD DOWN / 🔓 SSHD DRIFT / ✅ RECOVERED | ufw, fail2ban or unattended-upgrades stops; sshd stops being keys-only (as `sshd -T` resolves it) | `scripts/hetzner/install-security-watch.sh` (security-check.sh, 5-min timer) |
| 📝 N SENSITIVE FILE(S) CHANGED: a, b, c (+k more) | A file an intruder edits to persist changes hash, owner or mode: sshd/sudoers/authorized_keys/shadow/cron/PAM/ld.so.preload/Caddy/ufw/monitoring/systemd units/apt sources — one grouped message per tick | `scripts/hetzner/install-security-watch.sh` (security-check.sh) |
| 🔌 NEW PORT OPEN TO THE INTERNET / 👤 NEW PRIVILEGED ACCOUNT / 🐳 NEW CONTAINER / 🧨 NEW SETUID BINARY | A non-loopback listener, a uid-0/shell/sudo/docker account, a container or a setuid binary appears that was not in the baseline | `scripts/hetzner/install-security-watch.sh` (security-check.sh) |
| 🔑 SSH LOGIN as \<user\> from \<ip\> / 🚨 SSH PASSWORD LOGIN ACCEPTED | A key login from an IP never seen in 30 days of history that is not a GitHub Actions runner (api.github.com/meta, cached daily); any password login at all | `scripts/hetzner/install-security-watch.sh` (security-check.sh) |
| ☠️ SUSPICIOUS PROCESS | A process executing from /tmp, /dev/shm or /var/tmp, or a known miner name | `scripts/hetzner/install-security-watch.sh` (security-check.sh) |
| 🗄️ OFFSITE BACKUP STALE / UNREACHABLE / ✅ RECOVERED | Newest restic snapshot older than 30h, or restic cannot list them (hourly) | `scripts/hetzner/install-security-watch.sh` (security-check.sh) |
| ♻️ REBOOT PENDING for N days | A kernel/security patch has waited on a reboot for more than a week (weekly at most) | `scripts/hetzner/install-security-watch.sh` (security-check.sh) |
| 🕵️ N SECRET(S) IN REPO \<repo\>: \<type\>×n / 🛡️ NEW CRITICAL DEPENDENCY ALERT(S) / 🌍 REPO NOW PUBLIC / 🔍 SECRET SCANNING OFF / 🧑‍💻 NEW ACCESS TO THE ORG / 🗝️ NEW DEPLOY KEY / 🎬 ACTIONS POLICY LOOSENED / 🐙 GITHUB CHECK BLIND | Daily read of the GitHub org through the box's gh login; secret alerts are read per repo (the org endpoint is blind), forks are skipped, and N new alerts in one repo are ONE message — the per-alert version sent 100 on 2026-09-14. A call the token cannot make is skipped (journal), never read as a value | `scripts/hetzner/install-security-watch.sh` (github-security-check.sh, daily 07:10) |
| 🔌 laptop: NEW PORT / 🔓 laptop: sshd is RUNNING / 🖥️ laptop: screen lock off / 🛡️ laptop: upgrades OFF / 🔑 laptop: ~/.ssh changed / 👤 laptop: NEW LOGIN ACCOUNT / 🐙 laptop: gh identity changed / ♻️ laptop: reboot pending | The operator's laptop (box SSH key, admin:org token, transcripts) every 30 min, on change only; delivered through the box's `lib-alert.sh` over SSH, desktop notification if the box is unreachable | `scripts/local/laptop-security-check` (user timer `laptop-security-check.timer`) |

## Loki self-checks (the platform watching itself)

| What arrives | Trigger | Source |
|---|---|---|
| Telemetry stale | Runner telemetry stops arriving | `src/app/api/crons/check-telemetry/route.ts` |
| Runner stalled / wrong version | Box-runner stops claiming or lags the shipped version | `src/app/api/crons/check-runner-stall/route.ts`, `src/app/api/crons/check-runner-version/route.ts` |
| Approvals waiting | Proposed actions sit undecided | `src/app/api/crons/check-pending-approvals/route.ts` |
| Feedback needs you (stalled Implement / no agent / Check live) | A dispatched fix is stuck or live and waiting for Confirm — one ping when the flag goes up | `src/app/api/crons/check-feedback-needs-you/route.ts`, `src/lib/feedback/notify-needs-you.ts` |
| Model id rot | A configured model id stops resolving | `src/app/api/crons/check-model-ids/route.ts` |
| Run escalation | A run needs the operator's decision to proceed | `src/db/queries/run-escalations.ts` |
| 📊 Ledger-ready (one-shot) | Run ledger reaches the improver threshold; self-disables after firing | `scripts/hetzner/ledger-ready-gate.sh` |
| 🏷 Rescale window (hcloud) | A bigger Hetzner tier becomes available for migration in fsn1 | `scripts/hetzner/hcloud-availability.sh` |

## Off-repo senders (registered here, owned elsewhere)

| Sender | What | Its own SSOT |
|---|---|---|
| Loki (OpenClaw) | Conversation, briefings, reminders — everything conversational | `/home/openclaw/.openclaw/cron/jobs.json` + OpenClaw config on bitbaum |
| orangecat repo | orangecat.ch uptime alerts | `orangecat/.github/workflows/uptime.yml` |

## Rules for adding a notification

1. Ask the channel question first: must the operator act, is it an outcome
   they are waiting for, or did they ask for the digest? If none — journal,
   not Telegram.
2. Route through the shared machinery — the only two blessed send paths:
   `lib-alert.sh` on the box (installed by
   `scripts/hetzner/install-host-alerts.sh`; use `alert_once` /
   `alert_transition` with a human subject) and
   `src/lib/actions/telegram-send.ts` in the app (self-only allowlist,
   fail-closed). A private `curl` to `api.telegram.org` repeats the
   2026-08-28 register-check double-send and is a reviewable smell.
3. Add the row here, in the same PR. CI (`check-telegram-registry.sh`) makes
   the omission fail loudly.
4. Test sends never deliver: `ALERT_DRY_RUN=1` (box), and never bare-run a
   sender "to see if it works" — 2026-08-28, a live test rang the phone with
   a message about nothing.
