#!/usr/bin/env bash
# Push-based alerting for the box — the piece a solo operator actually needs.
# Two mechanisms, both reusing the watchdog's Telegram channel + transition
# state, both ~zero RAM (systemd + a shell script on a timer; no daemon):
#
#   1. OnFailure alerts — a drop-in adds `OnFailure=notify-failure@%n` to every
#      *-app and appcron-* unit, so ANY unit that fails fires an instant Telegram
#      with the last journal lines. This is what turns "5 units failed silently
#      for weeks" (the audit finding) into "you knew within a minute".
#   2. Host checks — /opt/monitoring/host-check.sh (own timer) alerts, on
#      TRANSITION only, on: disk >85% (recovering only under 80%, so a disk
#      parked on the mark can't flap), mem-available <400MB OR swap >90%,
#      each failed unit KEYED SEPARATELY, postgres not accepting connections,
#      and any app whose .env its own unit User= cannot read — which it repairs
#      itself and reports, instead of asking a human for the one right answer.
#
# The governing rule for everything below: a message is worth sending only if a
# human must act on it AND nothing else can. One incident is one message
# (alert_once + a duplicate-text floor in lib-alert.sh); anything with a
# knowable remedy is applied, not announced; anything ELSE worth paging is also
# worth queuing a Loki remediation agent for (incident-dispatch.sh — one
# dispatch per incident, outcome delivered on run close); test runs set
# ALERT_DRY_RUN=1 and reach the journal only. Suppressed is never invisible —
# the journal always gets every alert.
#
# Logic here is covered by scripts/hetzner/test-host-alerts.sh (npm run test:ops),
# which extracts the heredoc payloads below and drives them with stubbed tools.
#
# Idempotent: re-run any time (after adding apps/crons) to (re)wire drop-ins.
# Alert target: /opt/monitoring/telegram.env (already present), else journal.
#
# Usage: install-host-alerts.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ssh -o BatchMode=yes "$BOX" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
MON=/opt/monitoring
mkdir -p "$MON/state"

# ── Shared alert helper (transition-aware, Telegram-or-journal) ──────────────
cat > "$MON/lib-alert.sh" <<'LIB'
#!/usr/bin/env bash
# Sourced by host-check.sh and notify-failure.sh. Provides:
#   alert <emoji> <text>              — send now (Telegram if configured, always journal)
#   alert_once <key> <cooldown> <emoji> <text>
#       — send at most once per <cooldown> seconds for <key>, so one incident is
#         one message however many times it is detected
#   alert_clear <key>                 — forget <key>'s cooldown; call on recovery
#   alert_transition <key> <state> <emoji> <up-or-down-text>
#       — send only when <key> flips state (state file under $MON/state)
# MON is overridable so test-host-alerts.sh can exercise this exact code against
# a temp dir; prod never sets it and gets /opt/monitoring.
#
# DELIVERY vs VISIBILITY. Every function here ALWAYS writes to the journal;
# only the Telegram send is ever suppressed. Quiet on the phone must never mean
# invisible in the logs — a suppressed alert nobody can find afterwards is a
# worse failure than the noise it saved.
MON="${MON:-/opt/monitoring}"
[ -f "$MON/telegram.env" ] && . "$MON/telegram.env" || true

_alert_key() { printf '%s' "$1" | tr -c 'a-zA-Z0-9' '_'; }

# Identical-text floor, under every other guard. The keyed cooldowns below are
# the deliberate mechanism, but they only protect callers that remember to pass
# a key: on 2026-08-28 the fleet register check sent the same four-line failure
# twice inside 60 seconds because it had its own private Telegram call and no
# state at all. This floor means a caller that forgets — today's or one written
# next year — still cannot repeat itself. Short enough (5 min) that a genuinely
# new occurrence of the same condition is never swallowed.
ALERT_DEDUPE_SEC="${ALERT_DEDUPE_SEC:-300}"

# ALERT_DRY_RUN=1 → journal only, nothing delivered. Every test probe and
# every "does the wiring still work" run MUST set it. On 2026-08-28 a live test
# of a new check and a planted zz-audit-probe.service both rang George's actual
# phone at 22:14 — a message about nothing, which is the exact failure this
# file exists to prevent. Testing the alerter must not page anyone.
# The one place anything is delivered. Journal first, always — every caller,
# every path, including the ones that decide not to deliver.
_alert_deliver() {
  local text="$1"
  logger -t watchdog "$text"
  if [ -n "${ALERT_DRY_RUN:-}" ]; then
    logger -t watchdog "ALERT dry-run, not delivered: $text"
    return 0
  fi
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${text}" -o /dev/null \
      || logger -t watchdog "ALERT telegram send failed"
  fi
  # Unconditional 0, for the same reason alert_transition ends that way.
  return 0
}

# Unkeyed send. This is the path with no idea whether it has said this before,
# so it — and ONLY it — gets the identical-text floor. alert_once and
# alert_transition have already made a deliberate, state-backed decision to
# speak; running them through the floor as well would mean two mechanisms
# arguing about one message, and the quieter one silently winning.
alert() {
  local text="$1 $2"
  mkdir -p "$MON/state"
  # Expire old dedupe stamps here rather than in a timer: this is the only code
  # that creates them, so it is the only code that has to remember them.
  find "$MON/state" -maxdepth 1 -name 'dedupe_*' -mmin +1440 -delete 2>/dev/null || true
  local h sf now last
  h=$(printf '%s' "$text" | md5sum | cut -c1-16)
  sf="$MON/state/dedupe_$h"
  now=$(date +%s); last=$(cat "$sf" 2>/dev/null | tr -dc '0-9')
  if [ -n "$last" ] && [ "$((now - last))" -lt "$ALERT_DEDUPE_SEC" ]; then
    logger -t watchdog "ALERT duplicate suppressed (${ALERT_DEDUPE_SEC}s window): $text"
    return 0
  fi
  printf '%s' "$now" > "$sf"
  _alert_deliver "$text"
  return 0
}

# One incident is one message, and reminders BACK OFF. The stamp holds
# "ts count": each successful claim quadruples the next reminder's wait
# (30m → 2h → 8h → daily, capped at a day). On 2026-08-29 George's phone got
# the same four failing crons every 30 minutes all morning — a thing that has
# been broken for six hours is not new information twice an hour, and the fix
# agent (incident-dispatch) already has the journal. alert_clear on recovery
# resets the ladder, so the next genuine outage pages immediately again.
#
# claim_once is the decision without the delivery: callers that want to speak
# about SEVERAL claimed subjects in one message (the host-check digest) claim
# each and deliver once. alert_once stays as claim+deliver for the one-subject
# callers (the OnFailure notifier, the env repair).
claim_once() {  # key base-cooldown → 0 = claimed (caller may speak), 1 = held
  local key="$1" cd="$2"
  local sf="$MON/state/paged_$(_alert_key "$key")"
  local now last count exp wait
  now=$(date +%s); last=""; count=0
  if [ -f "$sf" ]; then
    read -r last count < "$sf" 2>/dev/null || true
    last=$(printf '%s' "$last" | tr -dc '0-9')
    count=$(printf '%s' "${count:-}" | tr -dc '0-9'); count=${count:-0}
  fi
  if [ -n "$last" ]; then
    exp=0; [ "$count" -gt 0 ] && exp=$((count - 1)); [ "$exp" -gt 3 ] && exp=3
    wait=$(( cd * 4 ** exp )); [ "$wait" -gt 86400 ] && wait=86400
    if [ "$((now - last))" -lt "$wait" ]; then
      logger -t watchdog "ALERT held for ${key}: claimed $((now - last))s ago, next reminder after ${wait}s"
      return 1
    fi
  fi
  mkdir -p "$MON/state"
  printf '%s %s' "$now" "$((count + 1))" > "$sf"
  return 0
}
alert_once() {  # key cooldown emoji text
  claim_once "$1" "$2" || return 0
  _alert_deliver "$3 $4"
  return 0
}
alert_clear() { rm -f "$MON/state/paged_$(_alert_key "$1")"; return 0; }
alert_transition() {  # key state emoji text [subject]
  local key="$1" state="$2" emoji="$3" text="$4" subject="${5:-}"
  local kk; kk=$(printf '%s' "$key" | tr -c 'a-zA-Z0-9' '_')
  local sf="$MON/state/host_$kk" subf="$MON/state/subject_$kk"
  local prev="ok"; [ -f "$sf" ] && prev=$(cat "$sf")
  [ "$state" = "$prev" ] && return 0
  printf '%s' "$state" > "$sf"
  # A transition IS the deliberate decision, so deliver it directly rather than
  # through alert()'s floor: a unit that fails, recovers and fails again inside
  # five minutes is genuinely three events, and the floor would eat the third.
  #
  # Recovery names the SUBJECT, never the key. `✅ RECOVERED:
  # rtc_revampit_configured_host_does_not_resolve__typing_static_nvi` and
  # `✅ RECOVERED: agentwork_reparaturbonus-zh` both reached George's phone on
  # 2026-08-29 — closure messages nobody can parse, because this function used
  # to print its own state-file key. The subject is remembered at bad-time
  # (explicit 5th arg, else the text up to its first colon, else the key) so
  # the recovery can say the same human name the failure did.
  if [ "$state" = "bad" ]; then
    if [ -z "$subject" ]; then
      subject="${text%%:*}"
      { [ -z "$subject" ] || [ "$subject" = "$text" ]; } && subject="$key"
    fi
    printf '%s' "$subject" | cut -c1-60 > "$subf"
    _alert_deliver "$emoji $text"
  else
    local named=""; [ -f "$subf" ] && named=$(cat "$subf" 2>/dev/null)
    rm -f "$subf"
    _alert_deliver "✅ RECOVERED: ${named:-$key}"
  fi
  # MUST return 0 unconditionally. A trailing `[ "$state" = "ok" ] && alert ...`
  # here returned 1 on the bad path, so a caller written as
  #   check && alert_transition k bad ... || alert_transition k ok ...
  # ran the `ok` branch immediately after alerting — resetting the state file and
  # re-alerting every tick (the 2026-08-05 disk-alert storm: 40 alert/RECOVERED
  # pairs in 3h). Callers must never be able to read a branch's exit status as
  # "the check failed".
  return 0
}
LIB

# ── OnFailure notifier (invoked as notify-failure@<unit>.service) ────────────
cat > "$MON/notify-failure.sh" <<'NF'
#!/usr/bin/env bash
# $1 = the failed unit name (passed as %i from the template).
# Recovery-aware: a long-running service (Type != oneshot) that is back active
# a few seconds after the failure was a DEPLOY RESTART or a Restart=-recovered
# blip, not an outage — journal-only, no Telegram (kills the alert fatigue that
# fired on every deploy: a Next proc SIGKILLed after TimeoutStopSec marks the
# unit failed → OnFailure, even though the new version is healthy). Only PAGE
# when it stays down. oneshot units (appcron jobs) never go "active", so a
# failed cron always pages — a failed job is a real signal. Sustained crash
# loops are also caught by host-check's `systemctl --failed` sweep.
set -uo pipefail
MON="${MON:-/opt/monitoring}"
. "$MON/lib-alert.sh"
unit="${1:-unknown.unit}"
utype=$(systemctl show "$unit" -p Type --value 2>/dev/null)

# Per-unit page cooldown, via lib-alert's alert_once. The recovery guard below
# only silences a unit that comes BACK; a unit that cannot start at all fires
# OnFailure on every restart forever, and each one used to be a separate
# Telegram. On 2026-08-28 vitareba-app could not read its .env (root-owned
# after a chown --reference), so Restart=on-failure + RestartSec=3 produced 18
# restarts and SIX identical "UNIT DOWN" messages in 60 seconds — for ONE
# incident that no amount of paging would fix any faster. A crash loop is not
# new information every 3 seconds: page once, hold for COOLDOWN, then re-page
# as a reminder while it is still down. alert_clear on recovery is the other
# half, so the next genuine outage pages immediately instead of inheriting the
# last one's silence.
COOLDOWN=${NOTIFY_COOLDOWN_SEC:-1800}

if [ "$utype" != "oneshot" ]; then
  sleep 8
  if systemctl is-active --quiet "$unit"; then
    alert_clear "$unit"; alert_clear "dispatch:$unit"
    logger -t watchdog "unit ${unit} failed but recovered (restart/transient) — not paging"
    exit 0
  fi
else
  # A oneshot that a retry has ALREADY fixed is not an incident either. The
  # weekly restic-check failed at 18:41:42 on a 25-day-old stale lock left by
  # the laptop, was re-run at 18:42:28 and finished clean at 18:44:46 — and
  # still paged, because OnFailure fires on the failing run and nothing ever
  # looked again. So look again: wait out a retry window, then ask whether the
  # unit has since run. A retry in flight or a successful result means the
  # answer is already on its way and no human is needed. Nothing is lost by
  # waiting — if the retry fails too, its own OnFailure fires and we page then.
  sleep "${ONESHOT_GRACE_SEC:-90}"
  state=$(systemctl is-active "$unit" 2>/dev/null)
  result=$(systemctl show "$unit" -p Result --value 2>/dev/null)
  if [ "$state" = "active" ] || [ "$state" = "activating" ] || [ "$result" = "success" ]; then
    alert_clear "$unit"; alert_clear "dispatch:$unit"
    logger -t watchdog "oneshot ${unit} failed but a later run is active/succeeded — not paging"
    exit 0
  fi
fi

# The page shows the APP's error, not systemd's liturgy. The old message
# repeated the unit name four times ("appcron-kivvi-dunning.service: Main
# process exited … Failed with result … Failed to start appcron-kivvi-dunning
# … Triggering OnFailure") and buried the one line that mattered — the app's
# own `curl: (22) … HTTP 500`. Filter the boilerplate, keep the evidence.
tail=$(journalctl -u "$unit" -n 12 --no-pager -o cat 2>/dev/null \
  | grep -vE 'Main process exited|Failed with result|Failed to start|Triggering OnFailure|Scheduled restart|Start request repeated|Deactivated successfully|Consumed .* CPU time|^(Starting|Started|Stopping|Stopped) ' \
  | tail -n 4 | tr '\n' ' ' | cut -c1-300)
# A page-worthy failure is also dispatch-worthy: queue the remediation agent
# BEFORE composing the page, so the page can say the fix is already in motion —
# that one clause is the difference between "act now" and "read the outcome
# when it arrives". incident-dispatch has its own per-unit stamp, so the
# reminder re-page after COOLDOWN does not queue a second agent.
disp=$("$MON/incident-dispatch.sh" "$unit" 2>/dev/null || true)
alert_once "$unit" "$COOLDOWN" "🔴" "DOWN: ${unit%.service} — ${tail:-<no log>}${disp:+ → 🤖 fix agent dispatched (${disp}); outcome follows}"
NF
chmod +x "$MON/notify-failure.sh"

cat > /etc/systemd/system/notify-failure@.service <<'SVC'
[Unit]
Description=Telegram alert for failed unit %i
[Service]
Type=oneshot
# The notifier deliberately waits (8s for a service, ONESHOT_GRACE_SEC=90s for a
# oneshot) before deciding to page. DefaultTimeoutStartSec is 90s, so without an
# explicit timeout systemd would SIGTERM the notifier inside its own grace window
# and the page would silently never be sent — an anti-noise guard that turns into
# an anti-alert bug. Give it room for the longest wait plus the journal read.
TimeoutStartSec=300
# %i is the failed unit name (systemd-escaped); notify-failure.sh unescapes for display.
ExecStart=/opt/monitoring/notify-failure.sh %i
SVC

# ── Incident dispatch: a page should queue its own fix ───────────────────────
# The alerting above got very good at saying "X is broken" exactly once — and
# then a human still had to do the fixing. On 2026-08-29 George called that out
# directly: four appcron units re-paged every 30 minutes all morning (kivvi's
# USE_NEON leftover, vitareba's sandbox sender, revamp-info's missing
# CRON_SECRET), every one of them fixable by an agent, none of them fixed by
# one, because nothing here knew Loki exists. Meanwhile the Loki
# box-runner sat on this same machine polling an empty queue every 2 seconds.
#
# This script is the missing producer: when a unit failure is worth paging, it
# is also worth queuing a remediation agent for. POST /api/inject (the same
# call Loki's fc.sh dispatch makes) opens an orchestration run the box-runner
# claims within seconds; notifyOnClose:true means the run's CLOSE — root cause,
# what was done, what remains — is what lands on the phone. The page says a
# thing broke; the next message about it should be the outcome, not an echo.
#
# One incident is one dispatch, same discipline as one incident one message:
# a `dispatch:<unit>` stamp under the shared state dir, cleared by host-check's
# recovery sweep, so a crash loop queues ONE agent and a re-broken unit queues
# a fresh one. The dispatched agent runs sandboxed (no /opt, no service
# control — install-box-runner.sh's InaccessiblePaths): repo-shaped causes it
# fixes and PRs (deploy-on-merge is the repair channel); box-shaped causes it
# reports as exact commands. Either way the human reads a conclusion.
cat > "$MON/incident-dispatch.sh" <<'ID'
#!/usr/bin/env bash
# $1 = failed unit. stdout contract: prints the target project name IFF a
# remediation run was queued (callers may append that fact to their page);
# every other outcome is journal-only. Never exits non-zero into a caller's
# page path — a broken dispatcher must not cost the page itself.
set -uo pipefail
MON="${MON:-/opt/monitoring}"
. "$MON/lib-alert.sh"
unit="${1:?usage: incident-dispatch.sh <failed-unit>}"

# Token SSOT: the same ck_* agent token Loki's fc.sh authenticates with.
# Reusing the file means rotating the token stays a one-place edit.
ENV_FILE="${LOKI_TOKEN_FILE:-/home/openclaw/.openclaw/calendar-drain.env}"
BASE="${LOKI_API_URL:-http://127.0.0.1:4002}"
DISPATCH_COOLDOWN="${INCIDENT_DISPATCH_COOLDOWN_SEC:-21600}"   # 6h per unit

sf="$MON/state/paged_$(_alert_key "dispatch:$unit")"
now=$(date +%s); last=$(cat "$sf" 2>/dev/null | tr -dc '0-9')
if [ -n "$last" ] && [ "$((now - last))" -lt "$DISPATCH_COOLDOWN" ]; then
  logger -t watchdog "DISPATCH held for ${unit}: queued $((now - last))s ago, cooldown ${DISPATCH_COOLDOWN}s"
  exit 0
fi

if [ ! -f "$ENV_FILE" ]; then
  logger -t watchdog "DISPATCH skipped for ${unit}: token file $ENV_FILE missing"
  exit 0
fi
token=$(grep -m1 '^LOKI_AGENT_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
if [ -z "$token" ]; then
  logger -t watchdog "DISPATCH skipped for ${unit}: LOKI_AGENT_TOKEN not set in $ENV_FILE"
  exit 0
fi

# Unit → project. An app name can itself contain dashes (revamp-info), so an
# appcron unit name cannot be split by field — the unit's own ExecStart names
# the app as run.sh's first argument, and that is the only place the answer
# actually lives. Anything unmapped (restic, monitoring itself) goes to
# loki, which owns scripts/hetzner and therefore this machinery.
project=""
case "$unit" in
  appcron-*)
    project=$(systemctl show "$unit" -p ExecStart --value 2>/dev/null \
      | sed -n 's/.*run\.sh \([^ ;]*\).*/\1/p' | head -1)
    ;;
  *-app.service) project="${unit%-app.service}" ;;
esac
[ -n "$project" ] || project=loki

jtail=$(journalctl -u "$unit" -n 30 --no-pager -o cat 2>/dev/null | tail -c 3500)

prompt="Automated incident dispatch from bitbaum's monitoring (incident-dispatch.sh).

systemd unit \`${unit}\` on bitbaum FAILED and is still failed after the notifier's grace window. Journal tail:

${jtail:-<no journal output>}

Diagnose the root cause, then act:
- Repo-shaped cause (code, config template, workflow, migration, schema): implement the fix in this repo, run its verify gate, commit on a branch, push, and open a PR. Deploy-on-merge is the repair channel.
- Box-shaped cause (a file under /opt, an env value, a systemd unit) is OUTSIDE your sandbox: do not guess at workarounds — state the exact copy-paste commands that fix it and why they are safe.
- Already fixed by the time you look (a later run succeeded, the unit is active): say so and stop.

Your run-close summary is delivered to George's phone. One short paragraph: root cause → action taken → what (if anything) remains."

if [ -n "${ALERT_DRY_RUN:-}" ]; then
  logger -t watchdog "DISPATCH dry-run, not queued: ${unit} -> ${project}"
  exit 0
fi

_post() {  # $1 = project tab; prints the HTTP status code
  local json
  json=$(jq -n --arg tab "$1" --arg p "$prompt" \
    '{tab:$tab, customPrompt:$p, notifyOnClose:true}') || return 1
  curl -sS -m 20 -X POST "$BASE/api/inject" \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    -d "$json" -o /dev/null -w '%{http_code}' 2>/dev/null
}

http=$(_post "$project")
if [ "${http:0:1}" != "2" ] && [ "$project" != "loki" ]; then
  # An unregistered project must not cost the dispatch — the fleet repo owner
  # can still diagnose from the journal excerpt embedded in the prompt.
  logger -t watchdog "DISPATCH for ${unit}: project '${project}' rejected (HTTP ${http:-none}) — retrying as loki"
  project=loki
  http=$(_post "$project")
fi
if [ "${http:0:1}" = "2" ]; then
  printf '%s' "$now" > "$sf"
  logger -t watchdog "DISPATCH queued: ${unit} -> ${project} (outcome arrives on run close)"
  printf '%s\n' "$project"
else
  logger -t watchdog "DISPATCH failed for ${unit}: HTTP ${http:-none} from ${BASE} — the page stands alone"
fi
exit 0
ID
chmod +x "$MON/incident-dispatch.sh"

# ── Host-resource checks ─────────────────────────────────────────────────────
cat > "$MON/host-check.sh" <<'HC'
#!/usr/bin/env bash
set -uo pipefail
. "${MON:-/opt/monitoring}/lib-alert.sh"

# Disk (root fs) — bad above DISK_BAD_PCT, recovers only below DISK_OK_PCT.
# The gap is deliberate hysteresis: a disk parked exactly on a single threshold
# would otherwise flip state on normal churn (log write, tmp file) and page on
# every flip. Between the two marks we hold whatever state we were already in.
DISK_BAD_PCT=85
DISK_OK_PCT=80
dp=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "${dp:-0}" -gt "$DISK_BAD_PCT" ]; then
  alert_transition disk bad "💾" "DISK ${dp}% on / (>${DISK_BAD_PCT}%)"
elif [ "${dp:-100}" -lt "$DISK_OK_PCT" ]; then
  alert_transition disk ok "" ""
fi

# Memory — bad when available <400MB AND swap >90% (both = real pressure, not
# just healthy cache use / idle pages parked in swap).
# Pull the exact columns by index. The previous `read -r _ _ _ _ _ avail` gave
# six variables for the Mem line's SEVEN fields, so the trailing `avail` absorbed
# both buff/cache AND available ("3490 3283"). Every `[ "$avail" -lt 400 ]` then
# died with "integer expected", the `if` fell through to the else, and the memory
# check silently reported ok on every run since it was written — it could never
# have paged. Positional $N is immune to that whole class.
avail=$(free -m | awk '/^Mem:/{print $7}')
st=$(free -m | awk '/^Swap:/{print $2}')
su=$(free -m | awk '/^Swap:/{print $3}')
swpct=0; [ "${st:-0}" -gt 0 ] && swpct=$(( su * 100 / st ))
if [ "${avail:-9999}" -lt 400 ] && [ "$swpct" -gt 90 ]; then
  alert_transition mem bad "🧠" "MEM tight: ${avail}MB avail, swap ${swpct}%"
else
  alert_transition mem ok "" ""
fi

# Failed systemd units (excludes our own notifier so an alert can't self-trip)
#
# PER UNIT, not one boolean over the set. The previous version asked "is
# anything failed?" and passed that single answer to alert_transition — so once
# ONE unit failed and stayed failed, the state was pinned at `bad` and the
# check could never transition again. Every later failure was silent.
#
# That is not hypothetical: cloud-init-hotplugd.service failed on 2026-07-22
# and never recovered, and host_units sat at `bad` from 2026-07-17. For six
# weeks this check ran every tick, reported healthy machinery, and could not
# have paged for anything — including vitareba's crons dying on 2026-08-28.
# An aggregate over a set that contains a permanent member never changes.
#
# Keying by unit means a NEW failure is a new key, which always transitions,
# no matter what else is already broken. A unit that recovers clears its own
# key. Same alert_transition, same storm-safety, without the shared latch.
# --plain drops the leading "●" that systemd puts in front of a FAILED unit.
# Without it `awk '{print $1}'` returns the bullet instead of the unit name, so
# every failure becomes the same key and the same useless message ("FAILED
# UNIT: ●") — which is how this shipped once already. The sed is belt and
# braces for systemd builds that ignore --plain. The old aggregate code got
# away with the bullet because it only tested the string for emptiness.
#
# ONE INCIDENT IS ONE MESSAGE ACROSS DETECTORS, not just within one.
#
# This sweep and the OnFailure notifier are two independent detectors of the
# same fact, and on 2026-08-29 they both reported it: `⚙️ FAILED UNIT:
# orangecat-cat-outcomes.service` at 06:45 from here, `🔴 UNIT DOWN:
# orangecat-cat-outcomes.service` at 06:46 from notify-failure once its grace
# window expired. Each was individually correct and correctly deduplicated
# against itself — which is exactly why the duplicate survived a fix aimed at
# per-detector storms. Keying per detector still lets N detectors send N
# messages.
#
# So the cooldown key is the SUBJECT (the unit), shared with notify-failure:
# whichever detector notices first speaks, the other finds the claim already
# taken and goes to the journal. Neither has to know the other exists.
UNIT_COOLDOWN=${NOTIFY_COOLDOWN_SEC:-1800}
mapfile -t failed_units < <(systemctl list-units --type=service --state=failed --no-legend --plain 2>/dev/null \
  | sed 's/^[^A-Za-z0-9]*//' | awk '{print $1}' | grep -E '\.service$' | grep -v '^notify-failure@')
declare -A unit_now=()
announce=()
for u in ${failed_units[@]+"${failed_units[@]}"}; do
  k="failed_$(printf '%s' "$u" | tr -c 'a-zA-Z0-9' '_')"
  unit_now[$k]=1
  # ONE-TICK GRACE. A unit first seen failed is recorded and watched, not
  # paged: the OnFailure notifier already pages real failures within seconds
  # (with its own recovery guard), so the sweep's job is the PERSISTENT
  # failure, and a unit that is gone by the next tick was a deploy blip. On
  # 2026-08-29 11:19 an orangecat deploy failed three units for under five
  # minutes and George got six messages (3 FAILED + 3 RECOVERED) about a
  # non-event the notifier had already correctly declined to page.
  if [ ! -e "$MON/state/host_$k" ]; then
    printf '%s' "$u" > "$MON/state/host_$k"
    logger -t watchdog "sweep: ${u} failed, first sighting — watching, not paging"
    continue
  fi
  # The state file records WHICH units are known-failed (its content is the
  # unit name, so recovery can name it); claim_once decides whether anyone is
  # told — the same subject stamp the notifier uses, so whichever detector
  # speaks first claims the incident, and reminders back off together.
  printf '%s' "$u" > "$MON/state/host_$k"
  if claim_once "$u" "$UNIT_COOLDOWN"; then
    # Same dispatch as the OnFailure notifier, same shared `dispatch:` stamp —
    # whichever detector notices first queues the ONE agent.
    disp=$("$MON/incident-dispatch.sh" "$u" 2>/dev/null || true)
    announce+=("${u%.service}${disp:+ (🤖 ${disp})}")
  fi
done
# N failures in one tick are ONE message, not N. The morning of 2026-08-29
# reads as triples — 09:32, 10:02, 10:33, each three separate messages naming
# one unit apiece. A digest carries the same facts in a single glance.
if [ "${#announce[@]}" -gt 0 ]; then
  _alert_deliver "⚙️ STILL FAILING: $(printf '%s; ' "${announce[@]}" | sed 's/; $//')"
fi
# Anything that was failing and is not in the current set has recovered. Without
# this the key would stay set and its next genuine failure would be silent —
# the same latch, one level down. Report the recovery only if the failure was
# actually announced: closure on a message nobody received is just noise, and
# `✅ RECOVERED: unit____` is how that reads when the key is not a real name.
recovered=()
for sf in "$MON"/state/host_failed_*; do
  [ -e "$sf" ] || continue
  k=$(basename "$sf"); k=${k#host_}
  [ -n "${unit_now[$k]:-}" ] && continue
  u=$(cat "$sf" 2>/dev/null)
  if [ -n "$u" ] && [ -e "$MON/state/paged_$(printf '%s' "$u" | tr -c 'a-zA-Z0-9' '_')" ]; then
    recovered+=("${u%.service}")
  fi
  # Clear the dispatch stamp with the page stamp: a unit that recovers and
  # breaks again is a NEW incident and deserves a fresh agent, not the last
  # one's 6h silence.
  [ -n "$u" ] && alert_clear "$u" && alert_clear "dispatch:$u"
  rm -f "$sf"
done
# Same digest rule as the failures: closures that land on one tick are one
# message (10:58 on 2026-08-29 was three separate RECOVERED lines for one fix).
if [ "${#recovered[@]}" -gt 0 ]; then
  _alert_deliver "✅ RECOVERED: $(printf '%s; ' "${recovered[@]}" | sed 's/; $//')"
fi
# Retire the old aggregate latch, and the previous per-unit keys whose content
# was a bare ok/bad and whose name could not be turned back into a unit.
rm -f "$MON/state/host_units" "$MON"/state/host_unit_*

# App .env readability — repair it, don't report it.
#
# Every *-app unit runs as User= and sources /opt/<app>/shared/.env at start.
# If that file is not readable by that user the app cannot boot AT ALL: it
# crash-loops until a human notices. This happened TWICE on 2026-08-28 —
# vitareba at 18:38 (root-owned after a `chown --reference` of a root:root
# backup) and botsmann at 20:16 (root-owned by an ad-hoc edit four hours
# later). Both times the only signal was a wall of identical UNIT DOWN
# messages, and both times the remedy was the same one deterministic command.
#
# A failure whose correct answer is knowable is not worth a human's attention.
# The owner here is not a guess — it is the unit's own User=. So fix it, verify
# the fix, bring the app back, and send ONE message saying what was repaired: a
# report, not a request. The alert that remains is the one worth having, because
# it is the only way a recurring corruption ever becomes visible.
# APPROOT is overridable for the same reason MON is: so test-host-alerts.sh can
# drive this exact loop against a temp tree. Prod never sets it.
APPROOT="${APPROOT:-/opt}"
for unit in $(systemctl list-unit-files --no-legend --plain '*-app.service' 2>/dev/null | awk '{print $1}'); do
  app=${unit%-app.service}
  envf="$APPROOT/$app/shared/.env"
  [ -f "$envf" ] || continue
  user=$(systemctl show "$unit" -p User --value 2>/dev/null); user=${user:-root}
  if sudo -n -u "$user" test -r "$envf" 2>/dev/null; then
    # Healthy: drop any past repair stamp so a recurrence is reported again
    # rather than inheriting the previous repair's cooldown.
    alert_clear "envfix_$app"
    continue
  fi
  owner=$(stat -c '%U:%G' "$envf" 2>/dev/null)
  if chown "$user:$user" "$envf" 2>/dev/null && chmod 600 "$envf" 2>/dev/null \
     && sudo -n -u "$user" test -r "$envf" 2>/dev/null; then
    # The app is definitionally down at this point (it cannot have read its own
    # env), so a restart is not a risk — it is the rest of the repair. Clear the
    # start-limit first or systemd refuses to try again.
    systemctl reset-failed "$unit" >/dev/null 2>&1 || true
    systemctl restart "$unit" >/dev/null 2>&1 || true
    sleep 5
    up=$(systemctl is-active "$unit" 2>/dev/null)
    alert_once "envfix_$app" 3600 "🔧" \
      "FIXED (no action needed): $envf was $owner, unreadable by $user — re-owned to $user:$user and restarted $unit (now: $up). It could not have booted until this was done."
  else
    # Could not repair: this one IS a question, so ask it, once.
    alert_once "envbad_$app" 3600 "🔑" \
      "$envf is not readable by $user ($unit) and auto-repair failed — the app cannot start. Fix: chown $user:$user $envf && systemctl restart $unit"
  fi
done

# Postgres accepting connections
if pg_isready -q 2>/dev/null; then
  alert_transition postgres ok "" ""
else
  alert_transition postgres bad "🐘" "POSTGRES not accepting connections"
fi

# Runaway loops — one service repeating the same ERROR hundreds of times an hour.
#
# Every check above asks "is X down?". None asked "is X stuck doing the same
# failing thing forever?" — and a stuck loop looks HEALTHY to all of them: the
# unit is active, the process answers, nothing ever reaches `failed`. From
# 2026-09-21 to 2026-10-08 loki-calendar-drain retried one unbookable event
# every 15 s: 38,851 failures, a model call against the shared free tier on each
# pass, and not one message. This is that question, asked generically.
#
# Only error-shaped lines count (heartbeats like "drained 0" are by design and
# repeat too), digits are folded so "attempt 41" and "attempt 42" are one line,
# and the threshold sits well above any healthy chatter. One message per unit,
# with alert_once's backing-off reminders, and N loops in a tick are ONE digest.
LOOP_MIN=${LOOP_MIN_REPEATS:-120}
loop_report=$(journalctl --since "-1 hour" -q -o json --output-fields=_SYSTEMD_UNIT,MESSAGE 2>/dev/null \
  | LOOP_MIN="$LOOP_MIN" python3 -c '
import collections, json, os, re, sys
err = re.compile(r"fail|error|refus|denied|exception|timed? ?out|\b(4[0-9]{2}|5[0-9]{2})\b", re.I)
skip = re.compile(r"^(init\.scope|notify-failure@.*|watchdog\.service|host-check\.service)$")
counts = collections.Counter(); sample = {}
for raw in sys.stdin:
    try:
        e = json.loads(raw)
    except ValueError:
        continue
    unit, msg = e.get("_SYSTEMD_UNIT"), e.get("MESSAGE")
    if not isinstance(unit, str) or not isinstance(msg, str) or skip.match(unit) or not err.search(msg):
        continue
    key = (unit, re.sub(r"\d+", "#", msg)[:160])
    counts[key] += 1; sample[key] = msg
best = {}
for (unit, k), n in counts.items():
    if n >= int(os.environ["LOOP_MIN"]) and n > best.get(unit, (0, ""))[0]:
        best[unit] = (n, sample[(unit, k)])
for unit, (n, msg) in sorted(best.items()):
    print(f"{unit}\t{n}\t{msg[:140]}")
' 2>/dev/null || true)
loops=()
while IFS=$'\t' read -r lu ln lm; do
  [ -n "$lu" ] || continue
  if claim_once "loop:$lu" 86400; then
    loops+=("${lu%.service} ${ln}×/h: “${lm}”")
  else
    logger -t watchdog "loop: ${lu} still repeating (${ln}×/h) — already told, holding"
  fi
done <<< "$loop_report"
if [ "${#loops[@]}" -gt 0 ]; then
  _alert_deliver "🔁 LOOP — stuck repeating the same error, likely retrying something that cannot succeed: $(printf '%s; ' "${loops[@]}" | sed 's/; $//')"
fi
HC
chmod +x "$MON/host-check.sh"

cat > /etc/systemd/system/host-check.service <<'SVC'
[Unit]
Description=Box host-resource checks (disk/mem/failed-units/postgres)
After=network-online.target
[Service]
Type=oneshot
ExecStart=/opt/monitoring/host-check.sh
SVC
cat > /etc/systemd/system/host-check.timer <<'TIMER'
[Unit]
Description=Run host-check every 5 min
[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
Persistent=true
Unit=host-check.service
[Install]
WantedBy=timers.target
TIMER

# ── Wire OnFailure into every app + appcron unit (drop-ins, non-destructive) ─
wired=0
for u in $(systemctl list-unit-files --no-legend '*-app.service' 'appcron-*.service' 2>/dev/null | awk '{print $1}'); do
  d="/etc/systemd/system/${u}.d"; mkdir -p "$d"
  cat > "$d/onfailure.conf" <<EOF
[Unit]
OnFailure=notify-failure@%n.service
EOF
  wired=$((wired+1))
done

# ── Retire a unit that can only ever be noise ────────────────────────────────
# cloud-init-hotplugd has been `failed` since 2026-07-22 on a box with no
# hotplug events to handle. It is not an incident, it never recovers, and it is
# the member that pinned the OLD aggregate failed-units latch at `bad` for six
# weeks — hiding every real failure behind it (including vitareba's 25 crons
# dying). Now that the check is per-unit it re-pages this instead, which is the
# other failure mode of the same fact. Neither is right: a unit that can only
# produce noise should not be in the failed set at all. Mask it (reversible
# with `systemctl unmask`) rather than teach the checker to look away, so that
# `systemctl --failed` keeps meaning exactly "something is wrong here".
systemctl stop cloud-init-hotplugd.socket >/dev/null 2>&1 || true
systemctl mask cloud-init-hotplugd.socket cloud-init-hotplugd.service >/dev/null 2>&1 || true
systemctl reset-failed cloud-init-hotplugd.service >/dev/null 2>&1 || true
rm -f "$MON/state/host_unit_cloud_init_hotplugd_service"

systemctl daemon-reload
systemctl enable --now host-check.timer >/dev/null 2>&1 || true
echo "[host-alerts] wired OnFailure into $wired unit(s); host-check.timer active"
systemctl start host-check.service >/dev/null 2>&1 || true
echo "[host-alerts] initial host-check run: $(systemctl is-active host-check.service 2>/dev/null || echo done)"
REMOTE
echo "[host-alerts] installed on $BOX"
