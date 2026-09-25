#!/usr/bin/env bash
# install-app-crons.sh — reinstate the sibling apps' scheduled jobs as systemd
# timers on the Hetzner box.
#
# WHY: when the apps left Vercel (2026-06-12), Vercel Cron stopped firing the
# routes declared in each app's vercel.json `crons` array. Those daily/weekly
# jobs (emails, reminders, dunning, digests, …) silently stopped running. This
# script mirrors each app's vercel.json schedule into a systemd timer that calls
# the route on localhost with the app's CRON_SECRET (read from the app's .env at
# run time — the secret never lands in a unit file). The box is Etc/UTC, so the
# OnCalendar times equal the original cron UTC times.
#
# Each app's vercel.json remains the schedule SSOT; this registry mirrors it.
# Keep them in sync when a cron is added/removed.
#
# Idempotent — safe to re-run after a box rebuild or a schedule change.
# Usage: bash scripts/hetzner/install-app-crons.sh
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
HOST="$BOX_ROOT"

ssh -o BatchMode=yes "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail

# registry rows: app|port|OnCalendar|path|method   (method defaults to GET)
# Mirror of each app/vercel.json crons. petvity's routes are POST; the rest GET.
REGISTRY="$(cat <<'REG'
botsmann|4014|*-*-* 09:00:00|/api/rebuild|GET
aoz-wohnen|4008|*-*-* 08:00:00|/api/cron/notifications|GET
petvity|4013|*-*-* 07:00:00|/api/cron/emails|POST
petvity|4013|*-*-* 08:00:00|/api/cron/health-alerts|POST
petvity|4013|*-*-* 09:00:00|/api/cron/vaccination-reminders|POST
petvity|4013|*-*-* 10:00:00|/api/cron/medication-reminders|POST
petvity|4013|*-*-* 11:00:00|/api/cron/booking-reminders|POST
petvity|4013|Sun *-*-* 09:00:00|/api/cron/weekly-digest|POST
vitareba|4011|*-*-* 08:00:00|/api/cron/emails|GET
vitareba|4011|*-*-* 02:00:00|/api/cron/signals|GET
vitareba|4011|Sun *-*-* 08:00:00|/api/cron/weekly-digest|GET
vitareba|4011|*-*-* 07:00:00|/api/cron/checkin-reminder|GET
vitareba|4011|*-*-* 09:00:00|/api/cron/checkin-dip-alert|GET
kivvi|4005|*-*-* 06:00:00|/api/cron/recurring-invoices|GET
kivvi|4005|*-*-* 07:00:00|/api/cron/dunning|GET
kivvi|4005|*-*-* 08:00:00|/api/cron/webhook-retry|GET
revamp-info|4012|*-*-* 09:00:00|/api/cron/deadline-reminder|GET
revamp-info|4012|Mon *-*-* 08:00:00|/api/cron/data-quality|GET
surf-your-life|4009|*-*-* 18:00:00|/api/cron/reminders|GET
surf-your-life|4009|Sun *-*-* 17:00:00|/api/cron/weekly-report|GET
surf-your-life|4009|Sun *-*-* 19:00:00|/api/cron/ai-digest|GET
surf-your-life|4009|*-*-* 03:00:00|/api/cron/embed-backfill|GET
# sbb-fundbuero has no vercel.json; its schedule SSOT is this row + the app's TODO.md.
sbb-fundbuero|4016|*-*-* 03:30:00|/api/cron/purge|POST
# substrata has no vercel.json. All fire hourly: the sweep route decides from
# research_sweep_settings.everyHours whether a run is due (edited at
# /account/settings#sweep); filings fetch new EDGAR filings every hour.
substrata|4022|*-*-* *:17:00|/api/cron/sweep|POST
substrata|4022|*-*-* *:47:00|/api/cron/filings|POST
# No substrata drafts timer: George 2026-09-25 — no background job may spend
# free-tier AI. Drafting runs only when a reader asks, on their own key.
# auto-updates drafts ONLY for readers who opted in, on THEIR stored key and
# daily cap (substrata lib/auto-updates.ts); nobody opted in = no model call.
# substrata test/no-free-background-ai.test.ts keeps the free chain out of it.
substrata|4022|*-*-* *:32:00|/api/cron/auto-updates|POST
# Science pipeline: papers and grants per bottleneck (OpenAlex, arXiv, NSF, OpenAIRE,
# USAspending). The route takes the two bottlenecks searched longest ago.
substrata|4022|*-*-* *:02:00|/api/cron/science|POST
# Series: BLS producer price indexes mapped to bottlenecks, once a day (BLS
# publishes monthly; the keyless API allows a few dozen requests a day).
substrata|4022|*-*-* 06:12:00|/api/cron/series|POST
# Jobs: open roles from the public Greenhouse/Lever/Ashby boards of directory
# companies (research/job-boards.json), once a day, one board a second.
substrata|4022|*-*-* 05:23:00|/api/cron/jobs|POST
# Producer sourcing: finds sources for unverified producer rows into a review
# queue (research_source_candidates, migration 004). Four rows per run.
substrata|4022|*-*-* 00/6:52:00|/api/cron/source|POST
REG
)"

# Shared runner: reads CRON_SECRET from the app .env (if present) and calls the
# local app. The secret never leaves the box and isn't duplicated into units.
install -d /opt/_appcron
cat > /opt/_appcron/run.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
app="$1"; port="$2"; path="$3"; method="${4:-GET}"
envf="/opt/${app}/app/.env"
sec=""
[ -f "$envf" ] && sec="$(grep -m1 '^CRON_SECRET=' "$envf" 2>/dev/null | sed 's/^CRON_SECRET=//; s/^"//; s/"$//' | tr -d '\r')"
args=(-fsS -X "$method" -m 300 "http://127.0.0.1:${port}${path}")
[ -n "$sec" ] && args+=(-H "Authorization: Bearer ${sec}")
curl "${args[@]}" -o /dev/null -w "appcron ${app} ${method} ${path}: HTTP %{http_code}\n"
SH
chmod +x /opt/_appcron/run.sh

emit() {  # parse a row -> sets app port oncal path method job unit
  IFS='|' read -r app port oncal path method <<< "$1"
  method="${method:-GET}"
  job="${path##*/}"; job="${job//[^a-zA-Z0-9-]/-}"
  unit="appcron-${app}-${job}"
}

count=0
while IFS= read -r row; do
  [ -z "$row" ] && continue
  case "$row" in \#*) continue;; esac
  emit "$row"
  cat > "/etc/systemd/system/${unit}.service" <<SVC
[Unit]
Description=appcron ${app} ${method} ${path}
After=network-online.target ${app}-app.service
Wants=network-online.target
# Failed cron → instant Telegram (install-host-alerts.sh). Encoded here so a
# newly-synced cron is alertable immediately, not only after a separate run.
OnFailure=notify-failure@%n.service

[Service]
Type=oneshot
ExecStart=/opt/_appcron/run.sh ${app} ${port} ${path} ${method}
SVC
  cat > "/etc/systemd/system/${unit}.timer" <<TIMER
[Unit]
Description=appcron timer ${app} ${job}

[Timer]
OnCalendar=${oncal}
# Jitter so the many fixed-time app crons (several at 08:00) don't fire builds
# and curls simultaneously on the shared cores.
RandomizedDelaySec=300
Persistent=true
Unit=${unit}.service

[Install]
WantedBy=timers.target
TIMER
  count=$((count+1))
done <<< "$REGISTRY"

systemctl daemon-reload
while IFS= read -r row; do
  [ -z "$row" ] && continue
  case "$row" in \#*) continue;; esac
  emit "$row"
  systemctl enable --now "${unit}.timer" >/dev/null 2>&1
done <<< "$REGISTRY"

echo "✓ installed ${count} app-cron timers (UTC). Upcoming:"
systemctl list-timers 'appcron-*' --all --no-pager | grep -E 'appcron|NEXT' || true
REMOTE
