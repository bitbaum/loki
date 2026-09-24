#!/usr/bin/env bash
# The sweep exists because a fallback chain hid a provider that failed every
# call for days. These fixtures are REAL lines from that incident, so the test
# fails if the parser stops recognising the shape that actually occurred.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/ai-provider-check.sh"
pass=0; fail=0
ok() { if [ "$1" = 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "  ✗ $2"; fi }
# On a miss, SHOW what the command actually printed. A bare "expected output
# to mention 'DRY RUN'" is undiagnosable after the fact: this suite failed once
# inside a full `verify` on 2026-09-22 and passed 25/25 standalone, and there
# was no way to tell what the script had said instead. An assertion that hides
# its input turns an intermittent failure into a guess.
has() {
  if grep -qi -- "$2" <<<"$1"; then ok 0 ""; else
    ok 1 "expected output to mention '$2'"
    printf '      got (first 400 chars): %s\n' "$(printf '%s' "$1" | head -c 400 | tr '\n' '|')"
  fi
}
hasnt() { grep -qi -- "$2" <<<"$1" && ok 1 "output must NOT mention '$2'" || ok 0 ""; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
run() { JOURNAL_FILE="$1" MIN_FAILS="${2:-5}" bash "$SCRIPT" --report 2>&1; }

# Verbatim from journalctl -u orangecat-app on 2026-09-12.
cat > "$TMP/real.log" <<'LOG'
Sep 12 09:56:50 bitbaum launch.sh[3126908]: {"timestamp":"2026-09-12T09:56:50.767Z","level":"warn","message":"platform-llm: model call failed","data":{"link":"groq/openai/gpt-oss-120b","error":"groq/openai/gpt-oss-120b: 400 — {\"error\":{\"message\":\"Failed to validate JSON.\",\"code\":\"json_validate_failed\"}}"},"source":"PlatformLLM"}
Sep 12 09:56:55 bitbaum launch.sh[3126908]: {"timestamp":"2026-09-12T09:56:55.886Z","level":"warn","message":"Cat chat: provider failed, trying next fallback","data":{"from":{"provider":"groq","model":"openai/gpt-oss-120b"},"to":{"provider":"openrouter","model":"nvidia/nemotron-3-super-120b-a12b:free"},"reason":"rate_limit","err":{"type":"api_error","statusCode":429,"name":"GroqAPIError"}},"source":"cat/chat"}
LOG
for i in 1 2 3 4 5; do cat "$TMP/real.log" >> "$TMP/many.log"; done

echo "→ it finds the link that kept failing, and names the kind"
out=$(run "$TMP/many.log")
has "$out" "groq/openai/gpt-oss-120b"
has "$out" "json_validate_failed"
has "$out" "rate_limit"

echo "→ it reads BOTH shapes: the link field and from.provider+model"
# 5 of each shape; both resolve to the same link, so the count must be 10.
has "$out" "10 failure"

echo "→ below the threshold it says nothing rather than crying wolf"
out=$(run "$TMP/real.log")           # 1 of each shape, threshold 5
hasnt "$out" "groq/openai"
has "$out" "floor"                    # and it says what it cannot see

echo "→ an empty journal is COULD NOT LOOK, never a clean bill of health"
: > "$TMP/empty.log"
out=$(run "$TMP/empty.log")
has "$out" "read nothing"
hasnt "$out" "no link failed"

echo "→ a healthy window is reported honestly as a floor"
printf '%s\n' 'Sep 12 10:00:00 bitbaum launch.sh[1]: {"level":"info","message":"all good"}' > "$TMP/clean.log"
out=$(run "$TMP/clean.log")
has "$out" "no link failed"
has "$out" "successes are not logged"

echo "→ --report never touches the alert library"
# MON points at a directory with no lib-alert.sh: --report must still work.
out=$(MON="$TMP/nowhere" run "$TMP/many.log")
has "$out" "groq/openai/gpt-oss-120b"

echo "→ it reports a real rate once the app logs the wins"
{
  for i in 1 2 3; do
    printf '%s\n' '{"message":"platform-llm: model call failed","data":{"link":"groq/openai/gpt-oss-120b","error":"400 json_validate_failed"}}'
  done
  for i in 1 2 3 4 5 6 7; do
    printf '%s\n' '{"message":"platform-llm: model call served","data":{"link":"groq/openai/gpt-oss-120b"}}'
  done
} > "$TMP/rate.log"
out=$(run "$TMP/rate.log" 1)
has "$out" "70% served (7/10)"
has "$out" "3 failure"

echo "→ a served turn is never counted as a failure"
# The `link` field appears on BOTH shapes. Selecting on it alone would report
# ten failures here and alert on a link that answered seven times out of ten.
hasnt "$out" "10 failure"

echo "→ a link that only ever succeeded raises nothing at all"
for i in 1 2 3 4 5 6; do
  printf '%s\n' '{"message":"platform-llm: model call served","data":{"link":"groq/openai/gpt-oss-20b"}}'
done > "$TMP/won.log"
out=$(run "$TMP/won.log" 1)
hasnt "$out" "gpt-oss-20b"
has "$out" "no link failed"

echo "→ without served lines it still says floor, not rate"
out=$(run "$TMP/many.log" 1)
has "$out" "a floor, not a rate"
hasnt "$out" "% served"

echo
echo "ai-provider-check: $pass passed, $fail failed"
[ "$fail" = 0 ]
