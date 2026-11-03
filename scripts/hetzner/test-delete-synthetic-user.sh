#!/usr/bin/env bash
# Tests for delete-synthetic-user.sh against a fake GoTrue admin API: a real
# person's address is refused before anything is asked, the exact email (and
# only it) is deleted, two matches are never guessed between, the deletion is
# read back, and the service-role key is never printed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T=$(mktemp -d)
fail=0; ok() { echo "  ✓ $1"; }; bad() { echo "  ✗ $1"; fail=1; }

mkdir -p "$T/sb"
printf 'ANON_KEY=anon-test\nSERVICE_ROLE_KEY="service-secret-test"\n' > "$T/sb/.env"

# Fake admin API: users in $T/users.json, every request logged, the key checked.
cat > "$T/fake.py" <<'PY'
import json, sys, http.server
T = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj=None):
        body = json.dumps(obj).encode() if obj is not None else b""
        self.send_response(code); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def users(self): return json.load(open(T + "/users.json"))
    def handle_one(self):
        open(T + "/requests.log", "a").write(self.command + " " + self.path + "\n")
        if self.headers.get("apikey") != "service-secret-test" or self.headers.get("Authorization") != "Bearer service-secret-test":
            return self.send(401, {"msg": "no"})
        path, _, query = self.path.partition("?")
        users = self.users()
        if path == "/auth/v1/admin/users" and self.command == "GET":
            q = dict(p.split("=") for p in query.split("&") if p)
            page, per = int(q.get("page", 1)), int(q.get("per_page", 50))
            return self.send(200, {"users": users[(page - 1) * per: page * per]})
        uid = path.rsplit("/", 1)[-1]
        match = [u for u in users if u["id"] == uid]
        if not match: return self.send(404, {"msg": "User not found"})
        if self.command == "DELETE":
            json.dump([u for u in users if u["id"] != uid], open(T + "/users.json", "w"))
            return self.send(200, {})
        return self.send(200, match[0])
    do_GET = do_DELETE = handle_one
s = http.server.HTTPServer(("127.0.0.1", 0), H)
open(T + "/port", "w").write(str(s.server_port))
s.serve_forever()
PY
echo '[]' > "$T/users.json"
python3 "$T/fake.py" "$T" & PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$T"' EXIT
for _ in $(seq 1 50); do [ -s "$T/port" ] && break; sleep 0.1; done
PORT=$(cat "$T/port")

users() { printf '%s' "$1" > "$T/users.json"; : > "$T/requests.log"; }
run() { SUPABASE_DIR="$T/sb" SUDO="" AUTH_URL="http://127.0.0.1:$PORT/auth/v1" bash "$HERE/delete-synthetic-user.sh" "$@"; }

echo "delete-synthetic-user:"
# 600 users, so the exact match sits on the second page.
many=$(python3 -c '
import json
u=[{"id":"u%d"%i,"email":"person%d@example.com"%i} for i in range(600)]
u[550]={"id":"probe-id","email":"Passkey-Probe-1@Example.com"}
u.append({"id":"real-id","email":"passkey-probe-1@gmail.com"})
print(json.dumps(u))')

for addr in someone@gmail.com probe@example.org probe@example.com.evil.ch probe@sub.example.com "not an address" probe@invalid.example; do
  users "$many"
  if run delete "$addr" > "$T/out" 2>&1; then bad "refuses $addr"; else
    grep -q "refused\|not an email" "$T/out" && [ ! -s "$T/requests.log" ] && ok "refuses '$addr' before asking anything" || bad "refuses $addr cleanly"; fi
done

users "$many"
out=$(run show passkey-probe-1@example.com); grep -q "found passkey-probe-1@example.com: probe-id" <<<"$out" && ok "show finds the exact email on page two" || bad "show finds: $out"
grep -q DELETE "$T/requests.log" && bad "show deletes nothing" || ok "show deletes nothing"

users "$many"
run delete PASSKEY-PROBE-1@example.com > "$T/out" 2>&1 && grep -q "✓ deleted passkey-probe-1@example.com (probe-id)" "$T/out" && ok "delete removes it and reads it back" || { bad "delete"; cat "$T/out"; }
[ "$(grep -c '^DELETE' "$T/requests.log")" = 1 ] && grep -q "^DELETE /auth/v1/admin/users/probe-id$" "$T/requests.log" && ok "deletes only that id" || bad "deletes only that id"
grep -q '"real-id"' "$T/users.json" && grep -q '"u0"' "$T/users.json" && ok "every other user stays" || bad "others stay"

run delete passkey-probe-1@example.com > "$T/out" 2>&1 && grep -q "nothing to delete" "$T/out" && ok "a second run is a no-op" || bad "second run"

users '[{"id":"a","email":"x@lightning.invalid"},{"id":"b","email":"X@lightning.invalid"}]'
if run delete x@lightning.invalid > "$T/out" 2>&1; then bad "never chooses between two"; else grep -q "refusing to choose" "$T/out" && ! grep -q DELETE "$T/requests.log" && ok "never chooses between two matches" || bad "two matches"; fi

users '[{"id":"t","email":"probe@example.test"}]'
run delete probe@example.test > "$T/out" 2>&1 && grep -q "✓ deleted" "$T/out" && ok "accepts example.test" || bad "example.test"

grep -rq "service-secret-test" "$T/out" <(run show probe@example.test 2>&1) && bad "never prints the key" || ok "never prints the key"
[ $fail = 0 ] && echo "✓ delete-synthetic-user tests passed" || { echo "✗ delete-synthetic-user tests failed"; exit 1; }
