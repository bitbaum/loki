#!/usr/bin/env bash
# Behavioural test: how /opt/fleet/env and an app's own .env combine, at
# runtime (launch.sh.tmpl) and at build time (load-build-env.sh).
#
#   - an EMPTY app line keeps the fleet value (`RESEND_API_KEY=` in every app
#     template hid password recovery on three apps while the fleet held the key)
#   - a non-empty app value still wins
#   - FLEET_KEYS_OFF="A B" in the app's .env switches named fleet keys off
#   - an empty app line for a key the fleet does not hold stays empty
#   - no helper variable leaks into the app's environment
# Negative control: the old two-source version must fail the first rule.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
check() {
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; else
    echo "  ✗ $1 (expected '$2', got '$3')" >&2; fails=$((fails + 1)); fi
}

cat > "$T/fleet.env" <<'EOF'
# Fleet-wide shared keys
RESEND_API_KEY="re_fleet"
GROQ_API_KEY="gsk_fleet"
export GEMINI_API_KEY=gem_fleet
EOF
cat > "$T/app.env" <<'EOF'
RESEND_API_KEY=
GROQ_API_KEY="gsk_app"
GEMINI_API_KEY=""
RESEND_FROM=
FLEET_KEYS_OFF="GEMINI_API_KEY"
EOF

# What a launched server / a build would see, one line per variable.
probe='for v in RESEND_API_KEY GROQ_API_KEY GEMINI_API_KEY RESEND_FROM; do
  printf "%s=%s\n" "$v" "${!v-<unset>}"; done
  printf "LEAK=%s\n" "$(compgen -v | grep -c "^__f" || true)"'

# Runtime: render the template, point it at the fixture fleet file, stub node.
mkdir -p "$T/app" "$T/stub"
printf '%s\n' '#!/usr/bin/env bash' "$probe" > "$T/stub/node"; chmod +x "$T/stub/node"
echo '// entry' > "$T/app/server.js"; cp "$T/app.env" "$T/app/.env"
sed -e "s|__PORT__|4099|g" -e "s|/opt/fleet/env|$T/fleet.env|g" -e 's|/usr/bin/node|node|' \
  "$HERE/launch.sh.tmpl" > "$T/app/launch.sh"
runtime="$(env -i PATH="$T/stub:$PATH" bash "$T/app/launch.sh")"

# Build: source load-build-env.sh the way deploy.sh does.
build="$(env -i PATH="$PATH" SRC="$T" SELFHOST_ENV_FILE="$T/app.env" FLEET_ENV_FILE="$T/fleet.env" \
  bash -euo pipefail -c 'source "$1/load-build-env.sh"; '"$probe" -- "$HERE")"

for side in runtime build; do
  out="${!side}"; get() { sed -n "s/^$1=//p" <<<"$out"; }
  echo "$side:"
  check "empty app line keeps the fleet key" re_fleet "$(get RESEND_API_KEY)"
  check "non-empty app value wins" gsk_app "$(get GROQ_API_KEY)"
  check "FLEET_KEYS_OFF switches a fleet key off" "<unset>" "$(get GEMINI_API_KEY)"
  check "empty line for a non-fleet key stays empty" "" "$(get RESEND_FROM)"
  check "no helper variable leaks" 0 "$(get LEAK)"
done

# Negative control: the pre-fix runtime lines let the blank erase the key.
cat > "$T/old.sh" <<EOF
set -a; source "$T/fleet.env"; source "$T/app.env"; set +a
printf '%s\n' "\${RESEND_API_KEY-<unset>}"
EOF
check "negative control: old order lets an empty line erase the key" "" "$(bash "$T/old.sh")"

[ "$fails" -eq 0 ] || { echo "fleet-env merge: $fails check(s) FAILED" >&2; exit 1; }
echo "fleet-env merge: ok"
