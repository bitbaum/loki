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
[ -f "$F" ] || { echo "::error::no cron file at $F"; exit 1; }
[ -s "$PROMPT" ] || { echo "::error::missing $PROMPT"; exit 1; }
jq -e '.jobs | type == "array"' "$F" >/dev/null || { echo "::error::$F is not a cron file"; exit 1; }

BRIEF='morning brief|day plan|daily brief'
NOISE='swap|memory pressure|under memory|disk usage|cpu load|load average'

echo "Jobs before (name · enabled · schedule):"
jq -r '.jobs[] | "  \(.name) · \(.enabled) · \(.schedule.expr) \(.schedule.tz // "")"' "$F"

brief=$(jq --arg re "$BRIEF" '[.jobs[] | select(.name | test($re; "i"))] | length' "$F")
noisy=$(jq --arg re "$NOISE" '[.jobs[] | select(.enabled and ((.payload.message // "") | test($re; "i")))] | .[].name' "$F")

cp -a "$F" "$F.bak.$(date -u +%Y%m%dT%H%M%SZ)"
tmp=$(mktemp)
jq --rawfile msg "$PROMPT" --arg brief "$BRIEF" --arg noise "$NOISE" '
  .jobs |= map(
    if (.name | test($brief; "i")) then .payload.message = $msg
    elif (.enabled and ((.payload.message // "") | test($noise; "i"))) then .enabled = false
    else . end)' "$F" > "$tmp"
jq -e '.jobs | length > 0' "$tmp" >/dev/null || { echo "::error::refusing to write an empty cron file"; rm -f "$tmp"; exit 1; }
chown --reference="$F" "$tmp"; chmod --reference="$F" "$tmp"; mv "$tmp" "$F"

[ "$brief" -ge 1 ] && echo "Day plan prompt installed into $brief job(s)." \
  || echo "::warning::no job named like 'morning brief' — the prompt was not installed anywhere"
if [ -n "$noisy" ]; then echo "Switched off (machine warnings, now on Loki's /system list):"; echo "$noisy" | sed 's/^/  /'; fi
