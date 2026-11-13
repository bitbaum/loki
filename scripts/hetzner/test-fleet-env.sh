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
grep -q '^TAVILY_API_KEY *not set' <<<"$shown" || fail "show reports not set"
grep -q GEMINI <<<"$shown" && fail "GEMINI_API_KEY is not a fleet key"
case "$shown" in *gsk_*) fail "show never prints a value" ;; esac
out="$(bash "$HERE/fleet-env.sh" secret MAIL_INBOUND_SECRET)"
v="$(sed -nE 's/^MAIL_INBOUND_SECRET="([0-9a-f]{64})"$/\1/p' "$FLEET_ENV")"
[ -n "$v" ] || fail "secret generates 32 random bytes as hex"
case "$out" in *"$v"*) fail "secret never prints the value" ;; esac
bash "$HERE/fleet-env.sh" secret MAIL_INBOUND_SECRET >/dev/null
[ "$(grep -c '^MAIL_INBOUND_SECRET=' "$FLEET_ENV")" = 1 ] || fail "secret is generated once"
if bash "$HERE/fleet-env.sh" secret NOT_A_FLEET_KEY >/dev/null 2>&1; then fail "secret refuses a key not in fleet-keys.conf"; fi

# where / retire: a key is found and switched off in every file, value kept.
printf 'GEMINI_API_KEY="AIza_live"\n' >> "$FLEET_ENV"
printf 'GEMINI_API_KEY=AIza_live\nKEEP=1\n' >> "$T/a/shared/.env"
printf 'export GEMINI_API_KEY="AIza_other"\n' >> "$T/c/app/.env"
out="$(bash "$HERE/fleet-env.sh" where GEMINI_API_KEY)"
grep -q 'set in 4 file' <<<"$out" || fail "where counts every file that sets the key, a placeholder included"
case "$out" in *AIza_*) fail "where never prints a value" ;; esac
out="$(RESTART=0 bash "$HERE/fleet-env.sh" retire GEMINI_API_KEY)"
case "$out" in *AIza_*) fail "retire never prints a value" ;; esac
for f in "$FLEET_ENV" "$T/a/shared/.env" "$T/c/app/.env" "$T/b/shared/.env"; do
  grep -qE '^[[:space:]]*(export[[:space:]]+)?GEMINI_API_KEY=' "$f" && fail "retire leaves no live line in $f"
done
grep -q '^# retired [0-9-]*: GEMINI_API_KEY="AIza_live"$' "$FLEET_ENV" || fail "retire keeps the value as a dated comment"
grep -q '^KEEP=1$' "$T/a/shared/.env" || fail "retire touches no other line"
grep -q '^GROQ_API_KEY=' "$FLEET_ENV" || fail "retire touches no other key"
grep -q 'set in 0 file' <<<"$(bash "$HERE/fleet-env.sh" where GEMINI_API_KEY)" || fail "after retire the key is nowhere"
bash "$HERE/fleet-env.sh" seed >/dev/null
grep -qE '^GEMINI_API_KEY=' "$FLEET_ENV" && fail "seed never brings a retired key back"
if bash "$HERE/fleet-env.sh" retire NODE_ENV >/dev/null 2>&1; then fail "retire refuses a name that is not a credential"; fi
echo "fleet-env: all checks passed"
