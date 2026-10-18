#!/usr/bin/env bash
#
# Ask the LIVE Loki to create a preview, as the operator. Runs ON the box.
#
#   preview-create-on-box.sh name    <address> <name> [about] [code]
#   preview-create-on-box.sh website <url> [changes] [fixes] [answers] [code]
#   preview-create-on-box.sh move    <address> <new-address> [new name]
#   preview-create-on-box.sh ask     <project name> <what to change>
#   preview-create-on-box.sh status  <run id> [command id]
#
# `name` is "Build a preview" (POST /api/previews): a site researched from
# public sources. `website` is /change "Improve this site"
# (POST /api/projects/from-website): the free consultation's tour of the live
# site, the fixes kept (comma-separated check ids from src/config/site-consult,
# empty = none), the one-tap answers ("goal:buy,look:refresh") and anything
# said in words — exactly what a click on /change sends, so a run from Actions
# dogfoods the deployed path and nothing else. `move` gives a preview a new
# address and name (POST /api/previews/<address>/move); `ask` sends its builder
# a change, as Send in the session box does (POST /api/inject). `status` reads
# where a run `ask` started is (GET /api/orchestration/runs/<id>, and the
# queued command when given): the answer to "the change has not landed — is it
# waiting, running or failed?".
#
# Production Loki's database is loopback-only, so a session has to be minted
# where the data is (the same pattern as provision-widget-on-box.sh and
# loki-e2e-check.sh). The request then goes to the deployed app's own route, so
# what runs is exactly what a click runs, on the code that is actually deployed
# (the box checkout is often behind).
#
# A code given here is saved as the operator's and opens every preview they
# own. It is never echoed, and the response is printed with it masked: the
# Actions logs of a public repo are public.
#
# Exit: 0 created or already there, 3 no checkout, 4 no session, 5 refused.
set -uo pipefail

KIND="${1:?name|website}"; shift
BOX_LOKI="${BOX_LOKI:-/home/ubuntu/dev/loki}"
ENVF="${BOX_LOKI_ENV:-/opt/loki/app/.env}"
BASE="${LOKI_BASE_URL:-https://loki.orangecat.ch}"

set -a; . "$ENVF"; set +a
cd "$BOX_LOKI" || { echo "no Loki checkout at $BOX_LOKI"; exit 3; }

token=$(BASE="$BASE" npx tsx scripts/test/print-session-token.ts 2>/dev/null | tr -d '\n')
[ -n "$token" ] || { echo "could not mint a session on the box"; exit 4; }

case "$KIND" in
  name)
    ADDRESS="${1:?address}"; NAME="${2:?name}"; ABOUT="${3:-}"; CODE="${4:-}"
    route="/api/previews"
    body=$(ADDRESS="$ADDRESS" NAME="$NAME" ABOUT="$ABOUT" CODE="$CODE" python3 -c '
import json, os
raw = {"name": os.environ["NAME"], "address": os.environ["ADDRESS"], "about": os.environ["ABOUT"], "code": os.environ["CODE"]}
print(json.dumps({k: v for k, v in raw.items() if v}))')
    ;;
  website)
    WEBSITE="${1:?url}"; CHANGES="${2:-}"; FIXES="${3:-}"; ANSWERS="${4:-}"; CODE="${5:-}"
    route="/api/projects/from-website"
    body=$(WEBSITE="$WEBSITE" CHANGES="$CHANGES" FIXES="$FIXES" ANSWERS="$ANSWERS" CODE="$CODE" python3 -c '
import json, os, uuid
split = lambda s: [x.strip() for x in s.split(",") if x.strip()]
raw = {"website": os.environ["WEBSITE"], "mode": "refresh", "requestId": str(uuid.uuid4()),
       "changes": os.environ["CHANGES"], "fixes": split(os.environ["FIXES"]),
       "answers": split(os.environ["ANSWERS"]), "code": os.environ["CODE"]}
print(json.dumps({k: v for k, v in raw.items() if v}))')
    ;;
  move)
    FROM="${1:?address}"; TO="${2:?new address}"; NEWNAME="${3:-}"
    route="/api/previews/$FROM/move"
    body=$(TO="$TO" NEWNAME="$NEWNAME" python3 -c '
import json, os
raw = {"to": os.environ["TO"], "name": os.environ["NEWNAME"]}
print(json.dumps({k: v for k, v in raw.items() if v}))')
    ;;
  ask)
    TAB="${1:?project name}"; TEXT="${2:?what to change}"
    route="/api/inject"
    body=$(TAB="$TAB" TEXT="$TEXT" python3 -c '
import json, os
print(json.dumps({"tab": os.environ["TAB"], "customPrompt": os.environ["TEXT"], "notifyOnClose": True}))')
    ;;
  status)
    RUN="${1:?run id}"; CMD="${2:-}"
    for path in "/api/orchestration/runs/$RUN" ${CMD:+"/api/control/commands/$CMD"}; do
      echo "GET $path → $(curl -sS -m 60 -o /tmp/preview-status.json -w '%{http_code}' \
        -H "Cookie: __Secure-authjs.session-token=$token" "$BASE$path")"
      python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), ensure_ascii=False)[:1500])' /tmp/preview-status.json 2>/dev/null \
        || head -c 600 /tmp/preview-status.json
      echo
    done
    rm -f /tmp/preview-status.json
    # The usual reason a change waits: the cloud builder is held for an update
    # until its agents are idle (src/lib/runner-update-hold.ts). Its state and
    # the drain's last words (counts only — these logs are public).
    echo "builder: $(systemctl show loki-box-runner.service -p ActiveState -p ActiveEnterTimestamp --value 2>/dev/null | tr '\n' ' ')"
    (journalctl -t loki-drain -n 4 --no-pager -o short-iso 2>/dev/null || sudo -n journalctl -t loki-drain -n 4 --no-pager -o short-iso 2>/dev/null) | sed 's/^/drain:   /'
    exit 0
    ;;
  *) echo "usage: preview-create-on-box.sh name <address> <name> [about] [code] | website <url> [changes] [fixes] [answers] [code] | move <address> <new-address> [name] | ask <project> <text> | status <run id> [command id]" >&2; exit 2 ;;
esac

# A move attaches one address and takes another away, each waiting on Caddy.
wait=150; [ "$KIND" = move ] && wait=330
out=$(mktemp); trap 'rm -f "$out"' EXIT
http=$(curl -sS -o "$out" -w '%{http_code}' -m "$wait" -X POST "$BASE$route" \
  -H 'Content-Type: application/json' \
  -H "Cookie: __Secure-authjs.session-token=$token" --data "$body")
echo "HTTP $http"
# The access code travels in the response; it does not travel into the log.
python3 -c '
import json, sys
raw = open(sys.argv[1]).read()
try:
    data = json.loads(raw)
except Exception:
    print(raw[:700]); sys.exit(0)
def mask(o):
    if isinstance(o, dict): return {k: ("***" if k == "accessCode" and v else mask(v)) for k, v in o.items()}
    if isinstance(o, list): return [mask(x) for x in o]
    return o
print(json.dumps(mask(data), ensure_ascii=False)[:900])' "$out"
case "$http" in
  200|201) exit 0 ;;
  409) [ "$KIND" = name ] || [ "$KIND" = website ] || exit 5
       echo "already there"; exit 0 ;;
  *)   exit 5 ;;
esac
