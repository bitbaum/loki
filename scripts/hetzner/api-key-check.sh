#!/usr/bin/env bash
#
# Is every AI vendor key on this box still accepted?
#
# WHY
# ---
# On 2026-10-08 orangecat's GROQ_API_KEY had been revoked for days. The Cat's
# chat answered from other vendors (the fallback chain hid it), voice input just
# failed ("Could not transcribe that audio"), and the only watcher —
# ai-provider-check.sh, which reads failure LOGS — had muted that link weeks
# earlier. Eight other apps held the working shared key; orangecat alone kept
# the dead one, because its env lives in /opt/orangecat/app/.env while the rest
# use /opt/<app>/shared/.env, and a key rollout that walked shared/ skipped it.
#
# This asks the vendors directly instead of waiting for traffic to fail: every
# DISTINCT key, from EVERY app's env file (both layouts), against the vendor's
# free metadata endpoint. Listing models costs no tokens, so it obeys the
# standing rule that nothing in the background spends free-tier AI.
#
# VERDICTS (three, never two)
#   200            alive
#   401 / 403      DEAD — the key itself is rejected → alert, naming the apps
#   anything else  could not tell (network, 429, 5xx) → no state change
#
# Keys are never printed or put in a URL: identified by an 8-char sha256 prefix.
#
# Usage:
#   api-key-check.sh            # check + alert on state changes (Telegram)
#   api-key-check.sh --report   # print findings, never alert
#
# Overridable for tests (see test-api-key-check.sh):
#   MON        alert state/config dir   (default /opt/monitoring)
#   ENV_FILES  env files to read        (default /opt/*/shared/.env /opt/*/app/.env)
#   CURL       curl binary              (default curl)
set -uo pipefail   # NOT -e: one unreadable file or vendor must never abort the sweep

MON="${MON:-/opt/monitoring}"
CURL="${CURL:-curl}"
REPORT_ONLY=0
[ "${1:-}" = "--report" ] && REPORT_ONLY=1
if [ "$REPORT_ONLY" = 0 ]; then
  # shellcheck source=/dev/null
  . "$MON/lib-alert.sh"
fi

# VAR | vendor | endpoint | auth style. OpenRouter is asked on /key: its /models
# answers 200 for a DEAD key (measured), so it cannot tell alive from revoked.
VENDORS='GROQ_API_KEY|groq|https://api.groq.com/openai/v1/models|bearer
OPENROUTER_API_KEY|openrouter|https://openrouter.ai/api/v1/key|bearer
GEMINI_API_KEY|gemini|https://generativelanguage.googleapis.com/v1beta/models|goog
TOGETHER_API_KEY|together|https://api.together.xyz/v1/models|bearer'

# shellcheck disable=SC2206
files=(${ENV_FILES:-/opt/*/shared/.env /opt/*/app/.env})

app_of() {  # /opt/<app>/shared/.env | /opt/<app>/app/.env → <app>
  local d; d="$(dirname "$1")"; d="$(dirname "$d")"; basename "$d"
}

value_of() {  # first VAR=… in a file, quotes and `export ` stripped
  sed -nE "s/^(export[[:space:]]+)?$2=//p" "$1" 2>/dev/null | head -1 \
    | sed -E 's/^["'\'']//; s/["'\'']$//; s/[[:space:]]+$//'
}

fingerprint() { printf '%s' "$1" | sha256sum | cut -c1-8; }

probe() {  # key endpoint style → HTTP code (000 on network failure)
  if [ "$3" = goog ]; then
    "$CURL" -s -o /dev/null -w '%{http_code}' --max-time 15 -H "x-goog-api-key: $1" "$2"
  else
    "$CURL" -s -o /dev/null -w '%{http_code}' --max-time 15 -H "Authorization: Bearer $1" "$2"
  fi
}

checked=0
dead=0
alerted=" "
while IFS='|' read -r var vendor endpoint style; do
  [ -n "$var" ] || continue
  declare -A apps_by_fp=() key_by_fp=()
  for f in "${files[@]}"; do
    [ -r "$f" ] || continue
    k="$(value_of "$f" "$var")"
    [ -n "$k" ] || continue
    fp="$(fingerprint "$k")"
    key_by_fp[$fp]="$k"
    # Many apps have BOTH layouts (app/.env a copy of shared/.env): name each once.
    a="$(app_of "$f")"
    case ", ${apps_by_fp[$fp]:-}, " in
      *", $a, "*) ;;
      *) apps_by_fp[$fp]="${apps_by_fp[$fp]:-}${apps_by_fp[$fp]:+, }$a" ;;
    esac
  done

  alive_apps=""
  declare -A code_by_fp=()
  for fp in "${!key_by_fp[@]}"; do
    code="$(probe "${key_by_fp[$fp]}" "$endpoint" "$style")"
    code_by_fp[$fp]="$code"
    checked=$((checked + 1))
    [ "$code" = 200 ] && alive_apps="${alive_apps}${alive_apps:+, }${apps_by_fp[$fp]}"
  done

  for fp in "${!key_by_fp[@]}"; do
    code="${code_by_fp[$fp]}"
    akey="apikey_${vendor}_${fp}"
    case "$code" in
      401|403)
        dead=$((dead + 1))
        alerted="$alerted$akey "
        fix="Replace $var in each of those apps' env file (orangecat: /opt/orangecat/app/.env, others: /opt/<app>/shared/.env) and restart the app."
        [ -n "$alive_apps" ] && fix="$fix The $vendor key in $alive_apps works."
        msg="$vendor: DEAD API KEY #$fp (HTTP $code) in: ${apps_by_fp[$fp]}. $fix"
        if [ "$REPORT_ONLY" = 1 ]; then echo "$msg"; else alert_transition "$akey" bad "🔑" "$msg" "$vendor key #$fp"; fi
        ;;
      200)
        [ "$REPORT_ONLY" = 1 ] && echo "$vendor: key #$fp ok (${apps_by_fp[$fp]})"
        [ "$REPORT_ONLY" = 1 ] || alert_transition "$akey" ok "✅" ""
        alerted="$alerted$akey "
        ;;
      *)
        # Could not tell. Never flip state on it in either direction.
        alerted="$alerted$akey "
        [ "$REPORT_ONLY" = 1 ] && echo "$vendor: key #$fp could not be checked (HTTP $code) — no verdict (${apps_by_fp[$fp]})"
        ;;
    esac
  done
  unset apps_by_fp key_by_fp code_by_fp
done <<EOF
$VENDORS
EOF

# A key that was dead and is no longer in ANY env file was replaced: recover it.
if [ "$REPORT_ONLY" = 0 ]; then
  for sf in "$MON"/state/host_apikey_*; do
    [ -f "$sf" ] || continue
    k="${sf##*/host_}"
    case "$alerted" in *" $k "*) continue ;; esac
    [ "$(cat "$sf")" = bad ] && alert_transition "$k" ok "✅" ""
  done
fi

if [ "$REPORT_ONLY" = 1 ]; then
  echo "api-key-check: $checked distinct key(s) checked, $dead dead"
fi
exit 0
