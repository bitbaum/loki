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
[ -f /home/openclaw/.openclaw/workspace/HEARTBEAT.md ] && echo "OpenClaw heartbeat file present ($(wc -l < /home/openclaw/.openclaw/workspace/HEARTBEAT.md) lines)" || echo "No OpenClaw heartbeat file"
