#!/usr/bin/env bash
# Install the day plan's prompt into OpenClaw's cron file on the box, and switch
# off jobs that only post machine warnings to the chat.
#
# Runs ON the box as root (.github/workflows/openclaw-day-plan.yml pipes this
# directory over ssh). The cron file stays OpenClaw's: only the morning brief's
# payload.message is replaced, and only jobs whose prompt asks for swap/memory
# warnings are disabled (reversible: `enabled` flips back; a timestamped backup
# sits next to the file). Prints job NAMES and schedules only — this repo's
# Actions logs are public, so no prompt text and no delivery target.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
F="${OPENCLAW_CRON_FILE:-/home/openclaw/.openclaw/cron/jobs.json}"
PROMPT="$HERE/morning-brief.md"
CONTRACT="$HERE/contract.md"
DIGEST_CONTRACT="$HERE/digest-contract.md"
[ -f "$F" ] || { echo "::error::no cron file at $F"; exit 1; }
[ -s "$PROMPT" ] || { echo "::error::missing $PROMPT"; exit 1; }
[ -s "$CONTRACT" ] || { echo "::error::missing $CONTRACT"; exit 1; }
[ -s "$DIGEST_CONTRACT" ] || { echo "::error::missing $DIGEST_CONTRACT"; exit 1; }
jq -e '.jobs | type == "array"' "$F" >/dev/null || { echo "::error::$F is not a cron file"; exit 1; }

BRIEF='morning brief|day plan|daily brief|daily god brief'
NOISE='swap|memory pressure|under memory|disk usage|cpu load|load average'
# One morning message (owner, 2026-11-02): the people-you-meet notes are now
# part of the day plan, so their own 07:30 job is switched off.
FOLDED='meeting people brief'
# The email deadline scanner ran four times a day; twice is enough for a job
# that may only speak about a deadline in the next 48 hours.
SCANNER='email deadline scanner'
SCANNER_EXPR='0 8,17 * * *'
# Summaries the owner asked for (docs/telegram-notifications.md "keep them"):
# they still go out, but under the digest contract, never silenced wholesale.
DIGEST='reflection|digest|scorecard|evening wrap|weekly overview'

echo "Jobs before (name · enabled · schedule):"
jq -r '.jobs[] | "  \(.name) · \(.enabled) · \(.schedule.expr) \(.schedule.tz // "")"' "$F"

brief=$(jq --arg re "$BRIEF" '[.jobs[] | select(.name | test($re; "i"))] | length' "$F")
noisy=$(jq --arg re "$NOISE" '[.jobs[] | select(.enabled and ((.payload.message // "") | test($re; "i")))] | .[].name' "$F")

cp -a "$F" "$F.bak.$(date -u +%Y%m%dT%H%M%SZ)"
tmp=$(mktemp)
# Every other enabled job keeps its own prompt and gets the contract appended
# between markers — replaced, never stacked, on every install.
BEGIN='<!-- bitbaum:telegram-contract -->'; END='<!-- /bitbaum:telegram-contract -->'
jq --rawfile msg "$PROMPT" --rawfile contract "$CONTRACT" --rawfile digest "$DIGEST_CONTRACT" \
   --arg brief "$BRIEF" --arg noise "$NOISE" --arg dig "$DIGEST" \
   --arg folded "$FOLDED" --arg scanner "$SCANNER" --arg scanexpr "$SCANNER_EXPR" \
   --arg b "$BEGIN" --arg e "$END" '
  def strip: (. // "") | sub("\\n*" + $b + "[\\s\\S]*" + $e + "\\n*"; "");
  .jobs |= map(
    if (.name | test($brief; "i")) then .payload.message = $msg
    elif (.name | test($folded; "i")) then .enabled = false
    elif (.enabled and ((.payload.message // "") | test($noise; "i"))) then .enabled = false
    elif (.enabled and (.payload.message | type) == "string" and (.name | test($dig; "i")))
      then .payload.message = ((.payload.message | strip) + "\n\n" + $b + "\n" + $digest + $e)
    elif (.enabled and (.payload.message | type) == "string")
      then .payload.message = ((.payload.message | strip) + "\n\n" + $b + "\n" + $contract + $e)
    else . end)
  | .jobs |= map(if (.name | test($scanner; "i")) then .schedule.expr = $scanexpr else . end)' "$F" > "$tmp"
jq -e '.jobs | length > 0' "$tmp" >/dev/null || { echo "::error::refusing to write an empty cron file"; rm -f "$tmp"; exit 1; }
chown --reference="$F" "$tmp"; chmod --reference="$F" "$tmp"; mv "$tmp" "$F"

[ "$brief" -ge 1 ] && echo "Day plan prompt installed into $brief job(s)." \
  || echo "::warning::no job named like 'morning brief' — the prompt was not installed anywhere"
if [ -n "$noisy" ]; then echo "Switched off (machine warnings, now on Loki's /system list):"; echo "$noisy" | sed 's/^/  /'; fi
echo "Telegram contract on $(jq --arg b "$BEGIN" '[.jobs[] | select((.payload.message // "") | contains($b))] | length' "$F") job(s)."

# Who else can post to the chat? Paths only (this log is public): any file on
# the box that calls the Telegram API, and any that sends "restarted
# automatically"-style status lines. The registry (docs/telegram-notifications.md)
# must account for every path this prints.
echo "Files on the box that call the Telegram API:"
grep -rlI --exclude-dir=node_modules --exclude-dir=.git -e 'api.telegram.org' \
  /usr/local/bin /usr/local/sbin /opt/monitoring /etc/systemd/system /etc/cron.d /etc/cron.daily /etc/cron.hourly \
  /var/spool/cron /root/bin /home/*/bin /home/openclaw/.openclaw/workspace 2>/dev/null | sed 's/^/  /' || true
echo "Files that say 'restarted automatically' / 'was not running':"
grep -rlIi --exclude-dir=node_modules --exclude-dir=.git -e 'restarted automatically' -e 'was not running' \
  /usr/local/bin /opt/monitoring /etc/systemd/system /etc/cron.d /var/spool/cron /root /home/openclaw/.openclaw 2>/dev/null \
  | grep -v -e '/sessions/' -e '\.jsonl$' -e '/logs/' | sed 's/^/  /' || true
# The heartbeat is OpenClaw's other way to speak unprompted: an agent turn on a
# timer that reads HEARTBEAT.md. The same contract goes there, between the same
# markers, so "Gateway was not running. Restarted automatically. All good now."
# (health-guardian.sh's status line, relayed by the agent) stays silent too.
HB=/home/openclaw/.openclaw/workspace/HEARTBEAT.md
if [ -f "$HB" ]; then
  cp -a "$HB" "$HB.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  hb_tmp=$(mktemp)
  awk -v b="$BEGIN" -v e="$END" 'index($0,b){skip=1} !skip{print} index($0,e){skip=0}' "$HB" \
    | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' > "$hb_tmp"
  { cat "$hb_tmp"; printf '\n%s\n' "$BEGIN"; cat "$CONTRACT"; printf '%s\n' "$END"; } > "$HB"
  rm -f "$hb_tmp"
  chown openclaw:openclaw "$HB" 2>/dev/null || true
  echo "Telegram contract on the OpenClaw heartbeat ($(wc -l < "$HB") lines)."
else
  echo "No OpenClaw heartbeat file"
fi

# health-guardian (OpenClaw's own watcher, an off-repo script run by the user
# unit openclaw-guardian.service) heals the gateway and then TELLS the owner
# so, straight through `openclaw message send` — "Gateway was not running.
# Restarted automatically. All good now.", "Swap at 99%". A heal that worked
# needs nobody; Loki's check-gateway already sends the one message that needs
# him (with its Restart button). So: it keeps healing, it stops speaking. The
# send line becomes a no-op (`:` takes and ignores its arguments, so the line
# continuations still parse), with a dated backup, and the unit is restarted so
# the running copy is not the old one. Reversible: restore the backup.
GUARD_FILE=/home/openclaw/.openclaw/workspace/tools/health-guardian.sh
if [ -f "$GUARD_FILE" ] && grep -Eq '^[[:space:]]*openclaw message send' "$GUARD_FILE"; then
  cp -a "$GUARD_FILE" "$GUARD_FILE.bak-silenced-$(date -u +%Y%m%dT%H%M%SZ)"
  sed -i -E 's/^([[:space:]]*)openclaw message send/\1: openclaw message send/' "$GUARD_FILE"
  if bash -n "$GUARD_FILE"; then
    RT=/run/user/$(id -u openclaw)
    runuser -u openclaw -- env XDG_RUNTIME_DIR="$RT" DBUS_SESSION_BUS_ADDRESS="unix:path=$RT/bus" \
      systemctl --user restart openclaw-guardian.service 2>&1 | sed 's/^/  /' || true
    echo "health-guardian keeps healing and no longer messages the chat (unit restarted)."
  else
    cp -a "$(ls -t "$GUARD_FILE".bak-silenced-* | head -1)" "$GUARD_FILE"
    echo "::warning::health-guardian did not parse after the change; restored, left as it was"
  fi
fi

# Everything below only reports. A grep that finds nothing must not fail the
# install (it did, 2026-11-02 run 4: `set -o pipefail` + no crontab match).
set +e +o pipefail
# How does health-guardian run, and how does it speak? Lines only, with long
# numbers and anything token-like redacted (this log is public).
redact() { sed -E 's/[0-9]{6,}/<n>/g; s/((token|key|secret|password)[^ =:]*[=: ]+)[^ ]+/\1<redacted>/Ig'; }
GUARD=/home/openclaw/.openclaw/workspace/tools/health-guardian.sh
if [ -f "$GUARD" ]; then
  echo "health-guardian is started by:"
  { crontab -l -u openclaw 2>/dev/null | grep -n health-guardian | sed 's/^/  crontab:/'
    grep -n health-guardian "$HB" 2>/dev/null | sed 's/^/  HEARTBEAT.md:/'
    grep -rln health-guardian /etc/systemd /home/openclaw/.config/systemd 2>/dev/null | sed 's/^/  unit: /'
    jq -r '.jobs[] | select((.payload.message // "") | test("health-guardian")) | "  cron job: \(.name) · \(.enabled)"' "$F"
  } | redact
  echo "health-guardian's speaking lines:"
  grep -nE 'openclaw (message|send|agent)|curl|notify|echo .*(restart|running|swap|disk)' "$GUARD" | redact | sed 's/^/  /' | head -20
fi
exit 0
