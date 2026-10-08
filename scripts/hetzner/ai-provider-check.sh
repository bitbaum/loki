#!/usr/bin/env bash
#
# Does a model provider still answer, or has it been failing for days?
#
# WHY
# ---
# A fallback chain hides the thing it protects against. On 2026-09-12 Groq
# answered 400 `json_validate_failed` for EVERY structured Cat call — prompt
# suggestions, the offer engine, both writing engines, the intent router — and
# nothing anywhere said so. OpenRouter picked each one up, users saw answers,
# the health route stayed green, and the only trace was a warn line in a journal
# nobody reads. It had been that way for days and was found by hand.
#
# link-health.ts already makes a dead link CHEAPER (a 60s in-process breaker),
# but it deliberately forgets, and forgetting is the problem: a provider can be
# down forever and the symptom is a slightly slower reply.
#
# WHAT THIS MEASURES — and what it cannot
# ---------------------------------------
# Failures are always logged. Successes are logged only where the app emits
# "model call served" (orangecat's platform-llm does; other paths may not), so
# the rate is reported ONLY for links whose wins are visible. Everywhere else
# this is a failure count and says so: a link with zero failures may simply not
# have been called. A monitor that implies more than it knows is how the
# registry audit came to report "zero adopters" for packages with eight.
#
# Usage:
#   ai-provider-check.sh              # check + alert on state changes
#   ai-provider-check.sh --report     # print findings, never alert (safe anywhere)
#
# Overridable for tests (see test-ai-provider-check.sh):
#   MON         alert state/config dir     (default /opt/monitoring)
#   UNITS       systemd units to read      (default "orangecat-app loki-app")
#   WINDOW      journalctl --since value   (default "24 hours ago")
#   MIN_FAILS   alert threshold per link   (default 5)
#   JOURNAL_FILE  read this file instead of journalctl (tests)
set -uo pipefail   # NOT -e: one unreadable unit must never abort the sweep

MON="${MON:-/opt/monitoring}"
UNITS="${UNITS:-orangecat-app loki-app}"
WINDOW="${WINDOW:-24 hours ago}"
MIN_FAILS="${MIN_FAILS:-5}"
REPORT_ONLY=0
[ "${1:-}" = "--report" ] && REPORT_ONLY=1

# shellcheck source=/dev/null
if [ "$REPORT_ONLY" = 0 ]; then
  . "$MON/lib-alert.sh"
fi

read_journal() {
  if [ -n "${JOURNAL_FILE:-}" ]; then
    cat "$JOURNAL_FILE" 2>/dev/null
    return
  fi
  for unit in $UNITS; do
    journalctl -u "$unit" --since "$WINDOW" --no-pager 2>/dev/null
  done
}

log="$(read_journal)"

if [ -z "$log" ]; then
  # No lines at all is NOT "no failures" — it is a sweep that could not look.
  msg="ai-provider sweep read nothing from: $UNITS (window: $WINDOW)"
  if [ "$REPORT_ONLY" = 1 ]; then echo "$msg"; else alert_transition ai_provider_sweep bad "🚫" "$msg"; fi
  exit 0
fi
[ "$REPORT_ONLY" = 1 ] || alert_transition ai_provider_sweep ok "✅" "ai-provider sweep reachable"

# A `link` field alone does not say what happened to the call — a served turn
# and a dead one both carry it. Select by MESSAGE first, then read the link.
FAILED_RE='model call failed|provider failed, trying next fallback'
SERVED_RE='model call served'

link_ids() {
  {
    printf '%s\n' "$1" | grep -oE '"link":"[^"]+"' | sed 's/"link":"//; s/"$//'
    printf '%s\n' "$1" | grep -oE '"from":\{"provider":"[^"]+","model":"[^"]+"' \
      | sed 's/.*"provider":"//; s/","model":"/\//; s/"$//'
  }
}

failed_log=$(printf '%s\n' "$log" | grep -E "$FAILED_RE")
served_log=$(printf '%s\n' "$log" | grep -E "$SERVED_RE")
links=$(link_ids "$failed_log" | sort | uniq -c | sort -rn)

findings=0
alerted=""   # state keys raised this run — everything else may recover
while read -r count link; do
  [ -n "${link:-}" ] || continue
  [ "$count" -ge "$MIN_FAILS" ] || continue
  # Name the kind, because "11 failures" and "11 rate limits" call for
  # different actions: one is a bug, the other is a free tier doing its job.
  # A line names the link either joined ("groq/openai/gpt-oss-120b") or split
  # across provider and model fields. Match on both halves so the fallback
  # lines — the ones carrying `reason` — are not silently excluded.
  provider="${link%%/*}"
  model="${link#*/}"
  lines=$(printf '%s\n' "$failed_log" | grep -F "$model" | grep -F "$provider")
  kinds=""
  for kind in json_validate_failed rate_limit 429 413 404 401 timeout; do
    n=$(printf '%s\n' "$lines" | grep -c -- "$kind")
    [ "$n" -gt 0 ] && kinds="$kinds $kind=$n"
  done
  # A rate only when the wins are observable. Until the app logs a served
  # turn there is nothing to divide by, and inventing a denominator would
  # turn "we cannot see" into a confident percentage.
  served=$(link_ids "$served_log" | grep -c -x -- "$link")
  total=$((count + served))
  if [ "$served" -gt 0 ]; then
    rate="$(( served * 100 / total ))% served ($served/$total)"
  else
    rate="no served turn seen — a floor, not a rate"
  fi
  msg="$link: $count failure(s) in the last ${WINDOW%% ago}${kinds:+ —$kinds} · $rate"
  emoji="🧪"
  # A rejected key is not a flaky provider. It fails EVERY call until someone
  # replaces it, and the fallback chain hides it the whole time — orangecat's
  # Groq key was dead for days in 2026-10 while the chat answered from other
  # vendors and the mic simply broke. Say what it is and what to do.
  case "$kinds" in
    *" 401="*|*" 403="*)
      emoji="🔑"
      msg="$link: API KEY REJECTED (${kinds# }) — replace this provider's key in the app's env file, then restart the app. $count failure(s) in the last ${WINDOW%% ago} · $rate"
      ;;
  esac
  findings=$((findings + 1))
  key="aiprovider_$(printf '%s' "$link" | tr -c 'a-zA-Z0-9' '_')"
  alerted="$alerted $key "
  if [ "$REPORT_ONLY" = 1 ]; then
    echo "$msg"
  else
    alert_transition "$key" bad "$emoji" "$msg"
  fi
done <<EOF
$links
EOF

if [ "$findings" = 0 ]; then
  [ "$REPORT_ONLY" = 1 ] && echo "no link failed $MIN_FAILS+ times in the window (a floor: successes are not logged)"
fi

# RECOVERY. alert_transition pages only on a state FLIP, and this sweep used to
# set links `bad` and never `ok` — so a link that went bad once stayed bad for
# good and could never page again. groq/openai/gpt-oss-20b went bad on
# 2026-09-14 (rate limits); when orangecat's Groq KEY died weeks later the state
# was already `bad` and nothing was sent. A link below the threshold in a window
# this sweep could actually read is no longer failing: let it recover, so the
# next failure is news again. (An unreadable journal exited above — no recovery
# is ever inferred from not being able to look.)
if [ "$REPORT_ONLY" = 0 ]; then
  for sf in "$MON"/state/host_aiprovider_*; do
    [ -f "$sf" ] || continue
    key="${sf##*/host_}"
    case "$alerted" in *" $key "*) continue ;; esac
    [ "$(cat "$sf")" = bad ] && alert_transition "$key" ok "✅" ""
  done
fi
exit 0
