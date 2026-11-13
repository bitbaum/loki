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

# The other half of the restart window: the request is accepted, then the old
# process is stopped under it (curl 52, empty reply). The job runs once more
# only when loki-app.service's start time moved; a send-once job never does.
BIN="$TMP/bin"; mkdir -p "$BIN"
echo 100 > "$TMP/app-started"
cat > "$BIN/systemctl" <<SYS
#!/usr/bin/env bash
cat "$TMP/app-started"
SYS
chmod +x "$BIN/systemctl"
DROP_PORT=$(free_port)
sed "s#http://127.0.0.1:$PORT#http://127.0.0.1:$DROP_PORT#" "$TMP/fc-cron.sh" > "$TMP/fc-cron-drop.sh"
chmod +x "$TMP/fc-cron-drop.sh"
python3 - "$DROP_PORT" "$TMP" <<'PY' &
import sys, http.server, os
tmp = sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        name = self.path.rsplit("/", 1)[-1]
        mark = os.path.join(tmp, f"dropped-{name}")
        if not os.path.exists(mark):
            open(mark, "w").close()
            # "restart" the app only for the jobs that test a restart
            if name != "no-restart":
                path = os.path.join(tmp, "app-started")
                with open(path) as fh:
                    started = int(fh.read().strip() or "0")
                with open(path, "w") as fh:
                    fh.write(str(started + 1))
            self.close_connection = True
            return  # no response at all: curl reads an empty reply (52)
        self.send_response(200)
        self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(b'{"ok":true,"converged":1}')
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
DROP_SRV=$!
for _ in $(seq 1 40); do
  curl -s -o /dev/null "http://127.0.0.1:$DROP_PORT/api/crons/probe" && break
  sleep 0.25
done
set +e
DROP_OUT=$(PATH="$BIN:$PATH" "$TMP/fc-cron-drop.sh" sync-package-updates 2>&1); DROP_RC=$?
ONCE_OUT=$(PATH="$BIN:$PATH" "$TMP/fc-cron-drop.sh" send-digest-emails 2>&1); ONCE_RC=$?
NORE_OUT=$(PATH="$BIN:$PATH" "$TMP/fc-cron-drop.sh" no-restart 2>&1); NORE_RC=$?
set -e
kill "$DROP_SRV" 2>/dev/null
check "restart mid-run: the job runs once more on the new process and succeeds" \
  "$(grep -q 'restarted during this run (curl exit 52)' <<<"$DROP_OUT" && grep -q '"converged":1' <<<"$DROP_OUT" && [ "$DROP_RC" -eq 0 ] && echo 0 || echo 1)"
check "restart mid-run: a send-once job is not repeated, it fails as before" \
  "$([ "$ONCE_RC" -ne 0 ] && ! grep -q 'running it once more' <<<"$ONCE_OUT" && echo 0 || echo 1)"
check "an empty reply with no restart still fails (a real fault is not retried away)" \
  "$([ "$NORE_RC" -ne 0 ] && ! grep -q 'running it once more' <<<"$NORE_OUT" && echo 0 || echo 1)"

# The prune: a timer whose job left SCHED must leave the box. nudge-idle was
# retired on 2026-10-10 and its timer kept calling a deleted route (HTTP 404)
# every night, because the installer only ever added timers.
UNITS="$TMP/units"; mkdir -p "$UNITS"
touch "$UNITS/fc-cron@autopilot-night.timer" "$UNITS/fc-cron@nudge-idle.timer" "$UNITS/fc-cron@.service"
{
  echo 'set -euo pipefail'
  echo "systemctl() { echo \"\$*\" >> '$TMP/systemctl.log'; }"
  echo 'declare -A SCHED=( [autopilot-night]="02:30" )'
  sed -n '/^# PRUNE:BEGIN$/,/^# PRUNE:END$/p' "$SRC" | sed "s#/etc/systemd/system#$UNITS#g"
} > "$TMP/prune.sh"
check "prune: the block is present in the installer" \
  "$(grep -q 'fc-cron@\*.timer' "$TMP/prune.sh" && echo 0 || echo 1)"
PRUNE_RC=0; PRUNE_OUT=$(bash "$TMP/prune.sh" 2>&1) || PRUNE_RC=$?
check "prune: runs clean" "$([ "$PRUNE_RC" -eq 0 ] && echo 0 || echo 1)"
check "prune: a retired job's timer file is deleted" \
  "$([ ! -e "$UNITS/fc-cron@nudge-idle.timer" ] && echo 0 || echo 1)"
check "prune: the retired timer is disabled and its failed state cleared" \
  "$(grep -qx 'disable --now fc-cron@nudge-idle.timer' "$TMP/systemctl.log" \
     && grep -qx 'reset-failed fc-cron@nudge-idle.service' "$TMP/systemctl.log" && echo 0 || echo 1)"
check "prune: a job still in SCHED keeps its timer, untouched" \
  "$([ -e "$UNITS/fc-cron@autopilot-night.timer" ] && ! grep -q autopilot-night "$TMP/systemctl.log" && echo 0 || echo 1)"
check "prune: the service template is never touched" \
  "$([ -e "$UNITS/fc-cron@.service" ] && echo 0 || echo 1)"
check "prune: says what it removed" \
  "$(grep -q 'removed retired timer fc-cron@nudge-idle' <<<"$PRUNE_OUT" && echo 0 || echo 1)"

echo
echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]

# The sibling app runner lives in install-app-crons.sh. test:ops calls this
# file and not a second script, so the gate has to run here or CI never sees it.
echo
echo "→ app cron runner"
"$HERE/test-app-cron-runner.sh"
