#!/usr/bin/env bash
#
# builder-auth-check.sh must tell the three states apart from what Claude Code
# actually prints, and must never leak the token. The "disabled" fixture is
# the verbatim line from 2026-09-14.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/builder-auth-check.sh"
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
run() { PROBE_OUTPUT="$1" PROBE_EXIT="${2:-0}" bash "$SCRIPT" --report 2>&1; }

echo "→ the 2026-09-14 line is DISABLED, and the message says what to do"
out=$(run "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access" 1)
has "$out" "^disabled:"
has "$out" "ANTHROPIC_API_KEY"
has "$out" "setup-token"
has "$out" "loki-box-runner"

echo "→ an expired or invalid token is DISABLED too"
out=$(run "OAuth token has expired. Please log in again." 1)
has "$out" "^disabled:"

echo "→ a real answer is OK"
out=$(run "ok" 0)
has "$out" "^ok:"

echo "→ a timeout or missing CLI is DOWN, not ok and not disabled"
out=$(run "" 124)
has "$out" "^down:"
hasnt "$out" "^ok:"
out=$(run "claude CLI missing at /nowhere" 3)
has "$out" "^down:"

echo "→ --report never touches alert state (no lib-alert needed)"
out=$(MON=/nonexistent run "ok" 0)
has "$out" "^ok:"

echo "→ the runner env is read for the token but the token never appears in output"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
printf 'ANTHROPIC_API_KEY=sk-ant-api03-SECRETSECRET\nCLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-ALSOSECRET\n' > "$tmp/.env"
out=$(RUNNER_ENV="$tmp/.env" CLAUDE_BIN=/nonexistent/claude bash "$SCRIPT" --report 2>&1)
has "$out" "^down:"
has "$out" "claude CLI missing"
hasnt "$out" "SECRETSECRET"
hasnt "$out" "ALSOSECRET"

echo "→ no env credential and no sign-in is DOWN with the instruction, not DISABLED"
: > "$tmp/.env"
out=$(RUNNER_ENV="$tmp/.env" CLAUDE_BIN=/bin/true RUNNER_HOME="$tmp/nohome" RUNNER_USER=nobody bash "$SCRIPT" --report 2>&1)
has "$out" "^down:"
has "$out" "no env credential and no sign-in"

echo
echo "builder-auth-check: passed $pass, failed $fail"
[ "$fail" -eq 0 ]
