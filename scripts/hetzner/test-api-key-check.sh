#!/usr/bin/env bash
# api-key-check.sh against a fake curl and fake env files in BOTH box layouts.
# The case it exists for: one app (orangecat, env in app/.env) holding a revoked
# key while the others share a working one — it must name that app, point at
# the working key, and page exactly once.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/api-key-check.sh"
pass=0; fail=0
ok() { if [ "$1" = 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "  ✗ $2"; fi }
has() {
  if grep -qi -- "$2" <<<"$1"; then ok 0 ""; else
    ok 1 "expected output to mention '$2'"
    printf '      got: %s\n' "$(printf '%s' "$1" | head -c 500 | tr '\n' '|')"
  fi
}
hasnt() { grep -qi -- "$2" <<<"$1" && ok 1 "output must NOT mention '$2'" || ok 0 ""; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/opt/orangecat/app" "$TMP/opt/heidi/shared" "$TMP/opt/heidi/app" "$TMP/opt/kivvi/shared" "$TMP/mon/state"
printf 'GROQ_API_KEY="gsk_dead"\nOPENROUTER_API_KEY=sk-or-good\n' > "$TMP/opt/orangecat/app/.env"
printf 'GROQ_API_KEY=gsk_good\nexport GEMINI_API_KEY=gem-flaky\n' > "$TMP/opt/heidi/shared/.env"
printf "GROQ_API_KEY='gsk_good'\n" > "$TMP/opt/kivvi/shared/.env"
# heidi has BOTH layouts holding the same key, as most apps on the box do.
cp "$TMP/opt/heidi/shared/.env" "$TMP/opt/heidi/app/.env"

# Fake curl: the answer depends on the key in the header, exactly as a vendor's.
cat > "$TMP/curl" <<'CURL'
#!/usr/bin/env bash
args="$*"; echo "$args" >> "$(dirname "$0")/curl.log"
case "$args" in
  *gsk_dead*) printf 401 ;;
  *gsk_good*|*sk-or-good*) printf 200 ;;
  *gem-flaky*) printf 503 ;;
  *) printf 000 ;;
esac
CURL
chmod +x "$TMP/curl"
cat > "$TMP/mon/lib-alert.sh" <<'LIB'
alert_transition() {
  local sf="$MON/state/host_$1"; local prev=ok; [ -f "$sf" ] && prev=$(cat "$sf")
  [ "$2" = "$prev" ] && return 0
  printf '%s' "$2" > "$sf"; echo "FLIP $1 $2 :: $4" >> "$MON/flips.log"
}
LIB

files="$TMP/opt/*/shared/.env $TMP/opt/*/app/.env"
report() { ENV_FILES="$files" CURL="$TMP/curl" bash "$SCRIPT" --report 2>&1; }
alerting() { ENV_FILES="$files" CURL="$TMP/curl" MON="$TMP/mon" bash "$SCRIPT" 2>&1; }

echo "→ the dead key is found in the app/.env layout and named by app"
out=$(report)
has "$out" "groq: DEAD API KEY"
has "$out" "in: orangecat"
has "$out" "/opt/orangecat/app/.env"

echo "→ it points at the key that works, and the apps holding it"
has "$out" "The groq key in heidi, kivvi works"

echo "→ a shared key is checked ONCE, not once per app"
groq_calls=$(grep -c 'api.groq.com' "$TMP/curl.log")
ok "$([ "$groq_calls" = 2 ] && echo 0 || echo 1)" "expected 2 groq probes (2 distinct keys), got $groq_calls"

echo "→ a vendor that is down is 'could not tell', never 'dead'"
has "$out" "gemini: key #"
has "$out" "no verdict"
hasnt "$out" "gemini: DEAD"

echo "→ no key value ever reaches the output or a URL"
hasnt "$out" "gsk_dead"
hasnt "$out" "gsk_good"
hasnt "$(grep -v 'Authorization\|x-goog' "$TMP/curl.log" || true)" "gsk_"

echo "→ OpenRouter is asked on /key (its /models says 200 for a dead key)"
has "$(cat "$TMP/curl.log")" "openrouter.ai/api/v1/key"

echo "→ alerting: pages once for the dead key, never for the flaky vendor"
: > "$TMP/curl.log"
alerting >/dev/null
flips=$(cat "$TMP/mon/flips.log")
has "$flips" "apikey_groq_.* bad :: groq: DEAD API KEY"
hasnt "$flips" "gemini"
n=$(grep -c ' bad ' "$TMP/mon/flips.log")
ok "$([ "$n" = 1 ] && echo 0 || echo 1)" "expected exactly 1 page, got $n"

echo "→ a second run does not page again (state, not repetition)"
: > "$TMP/mon/flips.log"
alerting >/dev/null
hasnt "$(cat "$TMP/mon/flips.log")" " bad "

echo "→ once the dead key is replaced, it recovers"
printf 'GROQ_API_KEY=gsk_good\nOPENROUTER_API_KEY=sk-or-good\n' > "$TMP/opt/orangecat/app/.env"
alerting >/dev/null
has "$(cat "$TMP/mon/flips.log")" "apikey_groq_.* ok"

echo "→ by default it reads BOTH box layouts — the app/.env one is how orangecat was missed"
has "$(grep -E '^files=' "$SCRIPT")" '/opt/\*/shared/.env /opt/\*/app/.env'

echo
echo "api-key-check: $pass passed, $fail failed"
[ "$fail" = 0 ]
