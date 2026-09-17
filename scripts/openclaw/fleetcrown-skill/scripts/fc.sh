#!/usr/bin/env bash
# fc.sh — FleetCrown API wrapper for the chat agent's fleetcrown skill.
#
# Installed onto bitbaum at
#   /home/openclaw/.openclaw/workspace/skills/fleetcrown/scripts/fc.sh
# by scripts/openclaw/install-fleetcrown-skill.sh. It lived ONLY on the box
# until 2026-09-17, which meant the seam between the operator's chat and this
# app's action queue was unreviewable, undiffable and one `rm` from gone.
#
# Auth: reuses the box's existing agent token (SSOT: calendar-drain.env — the
# same ck_* token the calendar drain authenticates with). No token is printed.
set -euo pipefail

ENV_FILE="/home/openclaw/.openclaw/calendar-drain.env"
[ -f "$ENV_FILE" ] || { echo "error: $ENV_FILE not found (token source)"; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
BASE="${FLEETCROWN_API_URL:-http://127.0.0.1:4002}"
TOKEN="${FLEETCROWN_AGENT_TOKEN:?FLEETCROWN_AGENT_TOKEN missing in $ENV_FILE}"

api() { # api <method> <path> [json-body]
  local method=$1 path=$2 body=${3:-}
  local args=( -sS -m 30 -X "$method" "$BASE$path"
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" )
  [ -n "$body" ] && args+=( -d "$body" )
  local out http
  out=$(curl "${args[@]}" -w $'\n%{http_code}')
  http=${out##*$'\n'}
  out=${out%$'\n'*}
  if [ "${http:0:1}" != "2" ]; then
    # Error pages can be full HTML — keep chat-sized. Prefer the JSON error field.
    local msg
    msg=$(echo "$out" | jq -r '.error // empty' 2>/dev/null || true)
    [ -n "$msg" ] || msg=$(echo "$out" | head -c 200)
    echo "API error (HTTP $http): $msg" >&2
    return 1
  fi
  echo "$out"
}

jesc() { # JSON-escape a string via jq
  jq -Rn --arg v "$1" '$v'
}

resolve_id() { # resolve_id <prefix> — full id from pending list, fail on 0 or >1
  local prefix=$1 matches
  matches=$(api GET /api/actions/pending | jq -r --arg p "$prefix" '.pending[].id | select(startswith($p))')
  local n
  n=$(echo "$matches" | grep -c . || true)
  if [ "$n" -eq 0 ]; then echo "error: no pending action matches '$prefix'" >&2; return 1; fi
  if [ "$n" -gt 1 ]; then echo "error: '$prefix' is ambiguous ($n matches) — use more characters" >&2; return 1; fi
  echo "$matches"
}

cmd=${1:-help}
case "$cmd" in
  dispatch)
    project=${2:?usage: fc.sh dispatch <project> "<task>"}
    task=${3:?usage: fc.sh dispatch <project> "<task>"}
    api POST /api/inject "{\"tab\":$(jesc "$project"),\"customPrompt\":$(jesc "$task"),\"notifyOnClose\":true}" | jq .
    ;;
  hosted)
    project=${2:?usage: fc.sh hosted <project> "<task>"}
    task=${3:?usage: fc.sh hosted <project> "<task>"}
    api POST /api/hermes/dispatch "{\"projectKey\":$(jesc "$project"),\"task\":$(jesc "$task")}" | jq .
    ;;
  book)
    # Put an appointment in the operator's calendar.
    #
    # WHY THIS COMMAND EXISTS. `gog calendar create` is blocked on this box by
    # the safety shim (/usr/local/bin/gog), because an agent that can write to
    # the real calendar unattended — on a heartbeat, from a cron — is not a
    # thing anyone signed up for. But until now the skill had no OTHER way to
    # book either, so a plain "put the dentist in my calendar" hit the shim and
    # dead-ended in advice to go and use a website. The shim was doing its job;
    # there was simply no sanctioned road.
    #
    # This is that road. It proposes a STRUCTURED event (real start/end fields,
    # not a date buried in prose) to the action queue. What happens next is the
    # operator's own standing decision, made in advance at /approvals:
    #   - covered by a standing approval → approved and booked by the calendar
    #     drain within about fifteen seconds, and they get a Telegram
    #     confirmation once it is genuinely in the calendar;
    #   - not covered → it waits, and they get one-tap Approve/Reject buttons.
    # Either way the answer comes back HERE, in `status`, so the agent can tell
    # them what actually happened instead of guessing.
    #
    # Times must be absolute, with an offset (the API will not invent a
    # timezone): 2026-09-19T14:00:00+02:00. A bare YYYY-MM-DD means all-day.
    title=${2:?usage: fc.sh book "<title>" <start> [end] [location]}
    start=${3:?usage: fc.sh book "<title>" <start> [end] [location]}
    end=${4:-}
    location=${5:-}

    if [[ "$start" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
      when="\"eventDate\":$(jesc "$start"),\"allDay\":true"
    else
      when="\"eventStart\":$(jesc "$start")"
      [ -n "$end" ] && when="$when,\"eventEnd\":$(jesc "$end")"
    fi
    [ -n "$location" ] && when="$when,\"eventLocation\":$(jesc "$location")"

    api POST /api/actions/propose \
      "{\"type\":\"create_event\",\"title\":$(jesc "$title"),\"operatorRequested\":true,\"payload\":{\"eventTitle\":$(jesc "$title"),$when}}" \
      | jq '{status, reason, executed, deferred, id: .action.id, title: .action.title, deduped}'
    ;;
  pending)
    api GET /api/actions/pending | jq '.pending'
    ;;
  decide)
    prefix=${2:?usage: fc.sh decide <id-or-prefix> approve|reject}
    decision=${3:?usage: fc.sh decide <id-or-prefix> approve|reject}
    case "$decision" in approve|reject) ;; *) echo "error: decision must be approve or reject" >&2; exit 1 ;; esac
    id=$(resolve_id "$prefix")
    api POST "/api/actions/$id/decision" "{\"decision\":\"$decision\"}" | jq .
    ;;
  help|*)
    echo "usage: fc.sh dispatch <project> \"<task>\" | hosted <project> \"<task>\""
    echo "       fc.sh book \"<title>\" <start> [end] [location]"
    echo "       fc.sh pending | decide <id> approve|reject"
    ;;
esac
