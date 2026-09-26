#!/usr/bin/env bash
# Tests for the box's scheduled-job runner (fc-cron.sh). Runs anywhere — no box.
#
# The thing under test is a two-line curl, and it was wrong in a way that cost
# two months of blindness: `-o /dev/null` meant every nightly job logged exactly
# "HTTP 200" and nothing else. The frontier loop surfaced no proposal from
# 2026-06-24 to 2026-08-25 and the journal could not say whether it had skipped,
# drafted nothing, had everything rejected by the judge panel, or thrown — four
# different faults with identical evidence.
#
# So the gate is: the RESPONSE BODY must reach the journal, on success AND on
# failure, and a failing job must still exit non-zero so systemd marks the unit
# failed. Those pull in opposite directions — plain `curl -f` gives you the
# non-zero exit but discards the body — which is exactly why it needs a test.
#
# Usage: scripts/hetzner/test-cron-runner.sh
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SRC="$HERE/../install-hetzner-crons.sh"
[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null' EXIT

# Extract the shipped payload — the code under test is the code that ships.
sed -n "/<<'SH'\$/,/^SH\$/p" "$SRC" | sed '1d;$d' > "$TMP/fc-cron.sh"
[ -s "$TMP/fc-cron.sh" ] || { echo "FAIL: could not extract fc-cron.sh"; exit 1; }

# Free ports, not fixed ones: several sessions run verify on one machine at
# once, and two runs sharing 4997/4998 answered each other's jobs — the retry
# case failed twice in a day (2026-09-26) on files a colliding run never wrote.
free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'; }
PORT=$(free_port)
printf 'CRON_SECRET=testsecret\n' > "$TMP/.env"
sed -i "s#ENV_FILE=/opt/loki/app/.env#ENV_FILE=$TMP/.env#" "$TMP/fc-cron.sh"
sed -i "s#http://127.0.0.1:4002#http://127.0.0.1:$PORT#" "$TMP/fc-cron.sh"
# Same retry count, a fraction of the sleep — the retry LOGIC is under test,
# not production's ~13s deploy-restart window.
sed -i "s#RETRY_SLEEP_SECS=4#RETRY_SLEEP_SECS=0.2#" "$TMP/fc-cron.sh"
chmod +x "$TMP/fc-cron.sh"

# Stub app: /api/crons/ok returns a rich 200 body, anything else a 500 body.
python3 - "$PORT" <<'PY' &
import sys, http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        ok = self.path.endswith("/ok")
        self.send_response(200 if ok else 500)
        self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(
            b'{"drafted":3,"surfaced":0,"details":[{"score":41,"passed":false}]}' if ok
            else b'{"error":"generateProposals threw: groq 404 model_not_found"}')
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
SRV=$!
for _ in $(seq 1 40); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/api/crons/ok" && break
  sleep 0.25
done

pass=0; fail=0
check() { # name, actual-rc(0=ok)
  if [ "$2" -eq 0 ]; then pass=$((pass+1)); echo "  ✓ $1"
  else fail=$((fail+1)); echo "  ✗ $1"; fi
}

OUT=$("$TMP/fc-cron.sh" ok 2>&1); RC=$?
check "success: response body reaches the journal" \
  "$(grep -q '\"drafted\":3' <<<"$OUT" && echo 0 || echo 1)"
check "success: the HTTP status line is still its own line (existing greps keep matching)" \
  "$(grep -q '^fc-cron ok: HTTP 200$' <<<"$OUT" && echo 0 || echo 1)"
check "success: exits 0" "$([ "$RC" -eq 0 ] && echo 0 || echo 1)"

set +e
OUT=$("$TMP/fc-cron.sh" boom 2>&1); RC=$?
set -e
check "failure: the ERROR body reaches the journal (this is the one -f threw away)" \
  "$(grep -q 'model_not_found' <<<"$OUT" && echo 0 || echo 1)"
check "failure: still exits non-zero so systemd marks the unit failed" \
  "$([ "$RC" -ne 0 ] && echo 0 || echo 1)"

# Guard the specific regression: -o /dev/null in the shipped runner. Comments
# are stripped first — the runner's own comment explains the old behaviour, and
# a grep that reads prose as code is a gate that fails on its own documentation.
check "the runner never discards the body to /dev/null" \
  "$(grep -v '^[[:space:]]*#' "$TMP/fc-cron.sh" | grep -q -- '-o /dev/null' && echo 1 || echo 0)"

# The deploy-restart race: nothing listens on the port yet (connection
# refused, curl exit 7) when the job starts, then the app comes up mid-retry.
# This is the exact failure that paged the operator for check-runner-stall
# while loki-app.service was mid-restart and self-resolved a tick later.
RETRY_PORT=$(free_port)
sed "s#http://127.0.0.1:$PORT#http://127.0.0.1:$RETRY_PORT#" "$TMP/fc-cron.sh" > "$TMP/fc-cron-retry.sh"
chmod +x "$TMP/fc-cron-retry.sh"
# set +e: the subshell inherits errexit, and a failing job must still record
# its exit code — a missing rc file reads as a test crash, not a verdict.
(set +e; "$TMP/fc-cron-retry.sh" ok > "$TMP/retry-out.txt" 2>&1; echo $? > "$TMP/retry-rc.txt") &
RETRY_PID=$!
sleep 0.3
python3 - "$RETRY_PORT" <<'PY' &
import sys, http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(b'{"drafted":3,"surfaced":0,"details":[{"score":41,"passed":false}]}')
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
RETRY_SRV=$!
wait "$RETRY_PID" || true
kill "$RETRY_SRV" 2>/dev/null
RETRY_RC=$(cat "$TMP/retry-rc.txt")
RETRY_OUT=$(cat "$TMP/retry-out.txt")
check "retries through a transient connection-refused window and succeeds" \
  "$(grep -q '\"drafted\":3' <<<"$RETRY_OUT" && [ "$RETRY_RC" -eq 0 ] && echo 0 || echo 1)"

echo
echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
