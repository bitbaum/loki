#!/usr/bin/env bash
# Offline tests for fleet-env.sh: seeds the shared value, skips placeholders,
# never overwrites, never prints a value.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/a/shared" "$T/b/shared" "$T/c/app" "$T/d/shared"
printf 'GROQ_API_KEY="gsk_shared"\nOTHER=1\n' > "$T/a/shared/.env"
printf 'export GROQ_API_KEY=gsk_shared\nGEMINI_API_KEY=your-gemini-key\n' > "$T/b/shared/.env"
printf "GROQ_API_KEY='gsk_old'\n" > "$T/c/app/.env"
printf 'RESEND_API_KEY=re_live\n' > "$T/d/shared/.env"
export FLEET_ENV="$T/fleet/env" ENV_FILES="$T/*/shared/.env $T/*/app/.env"
fail() { echo "FAIL: $1"; exit 1; }

out="$(bash "$HERE/fleet-env.sh" seed)"
grep -q '^GROQ_API_KEY="gsk_shared"$' "$FLEET_ENV" || fail "seeds the value most apps share"
grep -q '^RESEND_API_KEY="re_live"$' "$FLEET_ENV" || fail "seeds a key held once"
grep -q GEMINI "$FLEET_ENV" && fail "a placeholder is never seeded"
case "$out" in *gsk_shared*|*re_live*) fail "never prints a value" ;; esac
[ "$(stat -c %a "$FLEET_ENV")" = 600 ] || fail "file is 600"

printf 'GROQ_API_KEY="gsk_rotated"\n' > "$FLEET_ENV.new"; cat "$FLEET_ENV" | grep -v GROQ >> "$FLEET_ENV.new"; mv "$FLEET_ENV.new" "$FLEET_ENV"
bash "$HERE/fleet-env.sh" seed >/dev/null
grep -q '^GROQ_API_KEY="gsk_rotated"$' "$FLEET_ENV" || fail "never overwrites a key already there"
[ "$(grep -c '^GROQ_API_KEY=' "$FLEET_ENV")" = 1 ] || fail "never adds a second copy"

shown="$(bash "$HERE/fleet-env.sh" show)"
grep -q '^GROQ_API_KEY *set' <<<"$shown" || fail "show reports set"
grep -q '^GEMINI_API_KEY *not set' <<<"$shown" || fail "show reports not set"
case "$shown" in *gsk_*) fail "show never prints a value" ;; esac
echo "fleet-env: all checks passed"
