# Box monitoring & alerts (bitbaum)

Push-based, near-zero-RAM. No Grafana/Prometheus — a solo operator needs
**alerts** (something happened, act now), not dashboards nobody watches at 04:00.
All alerts flow through the watchdog's Telegram channel (`/opt/monitoring/telegram.env`).

**The SSOT for everything that reaches the operator's Telegram — alerts,
digests, feedback pings, briefings — is `docs/telegram-notifications.md`**,
enforced by `scripts/ci/check-telegram-registry.sh` (part of `pnpm run verify`).
This file covers only the box-monitoring senders in that registry.

## What alerts you

| Signal | Mechanism | Installed by |
|---|---|---|
| Any `*-app` / `appcron-*` unit fails | systemd `OnFailure=notify-failure@%n` → Telegram with journal tail | `install-host-alerts.sh` + encoded in `sync-infra.sh` / `install-app-crons.sh` templates |
| Disk >85% · mem<400MB & swap>90% · failed units present · postgres down | `host-check.sh` on a 5-min timer, transition-only | `install-host-alerts.sh` |
| Any app URL down (4xx/5xx/unreachable) | `watch.sh` on a timer, transition-only | `install-watchdog.sh` |
| The box itself dies | external dead-man's-switch ping in `watch.sh` | `install-watchdog.sh` |
| A bigger Hetzner tier (cx43/cx53) opens for rescale in fsn1 | `hcloud-availability.sh` polls the API's `available_for_migration` on a 10-min timer, transition-only | `install-hcloud-watch.sh` |

Transition-only = you're pinged on the up→down and down→up edges, never every tick.

## What FIXES it (not just alerts)

A page is not the product — the outcome is. Two mechanisms act before a human:

- **Deterministic repairs, in-line**: anything whose correct remedy is knowable
  is applied and reported, never asked about. Today: an app `.env` its own
  `User=` cannot read is re-owned, the app restarted, and ONE `🔧 FIXED (no
  action needed)` message sent (`host-check.sh`).
- **Agent remediation, queued** (`incident-dispatch.sh`, since 2026-08-29):
  every unit failure that is worth paging also queues a Loki remediation
  run — `POST /api/inject` with the journal tail embedded, claimed by
  `loki-box-runner` within seconds. The page carries "🤖 fix agent
  dispatched (<project>)"; the run's close summary (root cause → action →
  what remains) lands on Telegram via `notifyOnClose`. One incident is one
  dispatch: a `dispatch:<unit>` stamp (6h) shared by both detectors, cleared
  on recovery. The agent is sandboxed (no `/opt`, no service control): it fixes
  repo-shaped causes and PRs them (deploy-on-merge is the repair channel), and
  reports box-shaped causes as exact commands. Token SSOT: the same `ck_*`
  agent token Loki's `fc.sh` uses (`/home/openclaw/.openclaw/calendar-drain.env`).

Covered end-to-end by `scripts/hetzner/test-host-alerts.sh` (`pnpm run test:ops`).

The rescale watcher exists because Falkenstein is capacity-blocked: the Hetzner
console *lists* cx43/cx53 as valid rescale targets ("supported"), but the API's
`available_for_migration` is empty, so a rescale actually fails. The watcher
polls the real signal and pings the moment a window opens — they can be brief.
Needs a read-only API token in `/opt/monitoring/hcloud.env`.

## Box-shaped repairs the agent hands back

The sandboxed incident agent cannot touch `/boot` or systemd, so when it names
a box-shaped cause the repair runs as a workflow: dry run first, then the real
run, and both runs' logs are the before and after.

- **`grub-initrd-fallback.service` failed, "invalid environment block"**:
  `/boot/grub/grubenv` is corrupt. Run `gh workflow run grubenv-repair.yml`
  (read-only check and plan), then `gh workflow run grubenv-repair.yml -f dry_run=false`.
  The script (`scripts/hetzner/grubenv-repair.sh`) copies the old block to
  `/root/grubenv.corrupt.<UTC time>`, creates and validates a fresh block, then
  moves it into place. If `GRUB_DEFAULT=saved`, it sets the default back to
  entry 0, then resets and restarts the unit. A valid block is never replaced.
  To undo it, copy the backup back over `/boot/grub/grubenv`.

## Resource guards

- Every `*-app` unit has `MemoryMax=1G` / `MemoryHigh=768M`: a leaking/runaway
  Next process is OOM-killed and restarted alone, never taking the box down.
  (Encoded in `sync-infra.sh`; a re-sync applies it to new apps.)

## Re-apply after adding an app or cron

```bash
bash scripts/hetzner/sync-infra.sh <app>        # unit gets OnFailure + MemoryMax
bash scripts/hetzner/install-app-crons.sh       # cron units get OnFailure
bash scripts/hetzner/install-host-alerts.sh     # (re)wire drop-ins for anything pre-existing
```

## If you ever DO want dashboards

Extend Loki's own `/system` page (already shows disk/mem/uptime) rather
than installing a monitoring stack — same data, zero extra RAM, and it dogfoods
the product. Grafana would cost 400–700MB on a box that runs at ~300MB free.
