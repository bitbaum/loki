#!/usr/bin/env bash
# Tests for the shared app-cron runner (install-app-crons.sh → /opt/_appcron/run.sh).
#
# On 2026-11-06 appcron-botsmann-rebuild exited 1 with no HTTP line. The runner
# reads CRON_SECRET with `set -e`, and grep exits 1 when the key is absent.
# botsmann's /api/rebuild does not use a secret, so the daily job died before
# curl. A present secret must still be sent, and an HTTP error must still fail
# the unit.
#
# Usage: scripts/hetzner/test-app-cron-runner.sh
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SRC="$HERE/install-app-crons.sh"
[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }

TMP=$(mktemp -d)
SRV=""
trap 'rm -rf "$TMP"; [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null || true' EXIT

sed -n "/<<'SH'\$/,/^SH\$/p" "$SRC" | sed '1d;$d' > "$TMP/run.sh"
[ -s "$TMP/run.sh" ] || { echo "FAIL: could not extract run.sh"; exit 1; }
# Point the env lookup at a fixture. The shipped path stays /opt/<app>/app/.env.
sed -i "s#envf=\"/opt/\${app}/app/.env\"#envf=\"$TMP/app.env\"#" "$TMP/run.sh"
chmod +x "$TMP/run.sh"

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'; }
PORT=$(free_port)
LOG="$TMP/hits.jsonl"

python3 - "$PORT" "$LOG" <<'PY' &
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
port, log = int(sys.argv[1]), sys.argv[2]
class H(BaseHTTPRequestHandler):
    def do_GET(self): self._handle()
    def do_POST(self): self._handle()
    def _handle(self):
        rec = {"path": self.path, "authorization": self.headers.get("Authorization")}
        with open(log, "a") as f:
            f.write(json.dumps(rec) + "\n")
        code = 500 if self.path.endswith("/fail") else 200
        body = b'{"ok":false}' if code == 500 else b'{"revalidated":true}'
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", port), H).serve_forever()
PY
SRV=$!
for _ in $(seq 1 40); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/api/rebuild" && break
  sleep 0.25
done

pass=0; fail=0
check() {
  if [ "$2" -eq 0 ]; then pass=$((pass+1)); echo "  ✓ $1"
  else fail=$((fail+1)); echo "  ✗ $1"; fi
}

last_hit() { tail -n 1 "$LOG" 2>/dev/null || true; }

run() { # stdout+stderr in $OUT, rc in $RC. set -e must not swallow the job's rc.
  set +e
  OUT=$("$TMP/run.sh" "$@" 2>&1)
  RC=$?
  set -e
}

: > "$LOG"
printf 'DATABASE_URL=postgres://local/botsmann\n' > "$TMP/app.env"
run botsmann "$PORT" /api/rebuild GET
check "absent CRON_SECRET: the job reaches the app and exits 0 (got rc=$RC)" \
  "$([ "$RC" -eq 0 ] && grep -q 'HTTP 200' <<<"$OUT" && echo 0 || echo 1)"
check "absent CRON_SECRET: no Authorization header" \
  "$(python3 -c 'import json,sys; print(0 if json.loads(sys.argv[1]).get("authorization") in (None,"") else 1)' "$(last_hit)")"

rm -f "$TMP/app.env"
: > "$LOG"
run botsmann "$PORT" /api/rebuild GET
check "missing env file: still calls the app and exits 0 (got rc=$RC)" \
  "$([ "$RC" -eq 0 ] && grep -q 'HTTP 200' <<<"$OUT" && echo 0 || echo 1)"

printf 'CRON_SECRET="s3cret"\nOTHER=1\n' > "$TMP/app.env"
: > "$LOG"
run heidi "$PORT" /api/cron/channels POST
check "present quoted CRON_SECRET: exits 0" "$([ "$RC" -eq 0 ] && echo 0 || echo 1)"
check "present quoted CRON_SECRET: sent as Bearer, quotes stripped" \
  "$(python3 -c 'import json,sys; print(0 if json.loads(sys.argv[1]).get("authorization")=="Bearer s3cret" else 1)' "$(last_hit)")"

: > "$LOG"
run botsmann "$PORT" /api/fail GET
check "HTTP 500: still exits non-zero so systemd marks the unit failed (got rc=$RC)" \
  "$([ "$RC" -ne 0 ] && echo 0 || echo 1)"
check "HTTP 500: the status line still reaches the journal" \
  "$(grep -q 'HTTP 500' <<<"$OUT" && echo 0 || echo 1)"

if [ "$(id -u)" -ne 0 ]; then
  printf 'DATABASE_URL=x\n' > "$TMP/app.env"
  chmod 000 "$TMP/app.env"
  run botsmann "$PORT" /api/rebuild GET
  chmod 644 "$TMP/app.env" || true
  check "unreadable env: exits 2, does not pretend the secret is absent (got rc=$RC)" \
    "$([ "$RC" -eq 2 ] && echo 0 || echo 1)"
fi

echo
echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
