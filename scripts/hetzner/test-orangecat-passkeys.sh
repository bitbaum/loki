#!/usr/bin/env bash
# Tests for orangecat-passkeys.sh on a fake Supabase directory: the four
# variables land in .env and in the auth service's environment exactly once,
# an RP id someone already chose is never moved, and the result is read back
# from the public settings.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "  ✓ $1"; }; bad() { echo "  ✗ $1"; fail=1; }

setup() {
  rm -rf "$T/sb"; mkdir -p "$T/sb" "$T/bin"
  cat > "$T/sb/docker-compose.yml" <<'YML'
services:
  studio:
    image: supabase/studio:x
    environment:
      STUDIO_PG_META_URL: http://meta:8080
  auth:
    container_name: supabase-auth
    image: supabase/gotrue:v2.180.0
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_SITE_URL: ${SITE_URL}
  rest:
    image: postgrest/postgrest:v12
    environment:
      PGRST_DB_SCHEMAS: public
YML
  printf 'ANON_KEY=anon-test\nSITE_URL=https://orangecat.ch\n' > "$T/sb/.env"
  echo '{"passkeys_enabled":false}' > "$T/settings.json"
  # Fake docker: "recreating" auth publishes what .env now says.
  cat > "$T/bin/docker" <<SH
#!/usr/bin/env bash
v=\$(sed -nE 's/^GOTRUE_PASSKEY_ENABLED=//p' "$T/sb/.env" | tail -1)
echo "{\"passkeys_enabled\":\${v:-false}}" > "$T/settings.json"
echo "\$*" >> "$T/docker.log"
SH
  chmod +x "$T/bin/docker"
}
run() { SUPABASE_DIR="$T/sb" DOCKER="$T/bin/docker" SUDO="" SETTINGS_URL="file://$T/settings.json" bash "$HERE/orangecat-passkeys.sh" "$@"; }

echo "orangecat-passkeys:"
setup
out=$(run show); echo "$out" | grep -q "auth service: auth (supabase/gotrue" && ok "finds the GoTrue service" || bad "finds the GoTrue service"
echo "$out" | grep -q "passkeys_enabled (public settings): false" && ok "show reads the public settings" || bad "show reads settings"

run apply > "$T/out" 2>&1 && ok "apply succeeds" || { bad "apply succeeds"; cat "$T/out"; }
for k in GOTRUE_PASSKEY_ENABLED=true GOTRUE_WEBAUTHN_RP_ID=orangecat.ch GOTRUE_WEBAUTHN_RP_DISPLAY_NAME=OrangeCat GOTRUE_WEBAUTHN_RP_ORIGINS=https://orangecat.ch; do
  [ "$(grep -c "^${k%%=*}=" "$T/sb/.env")" = 1 ] && grep -qx "$k" "$T/sb/.env" && ok ".env has $k once" || bad ".env has $k once"
done
auth=$(awk '/^  auth:/{on=1;next} on&&/^  [a-z]+:/{exit} on' "$T/sb/docker-compose.yml")
[ "$(echo "$auth" | grep -c 'GOTRUE_WEBAUTHN_RP_ID: ${GOTRUE_WEBAUTHN_RP_ID}')" = 1 ] && ok "auth passes the RP id through" || bad "auth passes the RP id"
grep -A3 '^  rest:' "$T/sb/docker-compose.yml" | grep -q PASSKEY && bad "other services untouched" || ok "other services untouched"
grep -q "up -d --no-deps --force-recreate auth" "$T/docker.log" && ok "recreates only auth" || bad "recreates only auth"
grep -q "✓ passkeys_enabled=true" "$T/out" && ok "reads back true" || bad "reads back true"

run apply > /dev/null 2>&1
[ "$(grep -c 'GOTRUE_PASSKEY_ENABLED: ${GOTRUE_PASSKEY_ENABLED}' "$T/sb/docker-compose.yml")" = 1 ] && ok "apply twice wires once" || bad "apply twice wires once"
[ "$(grep -c '^GOTRUE_PASSKEY_ENABLED=' "$T/sb/.env")" = 1 ] && ok "apply twice keeps one .env line" || bad "apply twice one line"

run rollback > "$T/out" 2>&1 && grep -q "✓ passkeys_enabled=false" "$T/out" && ok "rollback reads back false" || bad "rollback"

setup; echo GOTRUE_WEBAUTHN_RP_ID=supabase.orangecat.ch >> "$T/sb/.env"
if run apply > "$T/out" 2>&1; then bad "refuses to move an RP id someone set"; else grep -q "stranded" "$T/out" && ok "refuses to move an RP id someone set" || bad "refusal reason"; fi
grep -q "GOTRUE_PASSKEY_ENABLED" "$T/sb/docker-compose.yml" && bad "refusal changes nothing" || ok "refusal changes nothing"

grep -q "anon-test" <(run show 2>&1) && bad "never prints a value from .env" || ok "never prints a value from .env"
[ $fail = 0 ] && echo "✓ orangecat-passkeys tests passed" || { echo "✗ orangecat-passkeys tests failed"; exit 1; }
