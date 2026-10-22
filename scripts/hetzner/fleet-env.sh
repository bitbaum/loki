#!/usr/bin/env bash
#
# /opt/fleet/env — the fleet's shared keys, ONE copy on the box.
#
# WHY
# ---
# The AI vendors' keys were copied by hand into each app's .env. Eight apps
# held the shared Groq key; orangecat kept a revoked copy for days
# (2026-10-08, see api-key-check.sh) and skif never got one, so its AI
# features stayed switched off. A shared key held N times is rotated N times
# and forgotten once. Here it is held once; every app reads it first
# (launch.sh.tmpl, selfhost-deploy.yml) and its own .env may override it.
#
# Runs ON THE BOX as ubuntu (the user every app runs as).
#
# Usage:
#   fleet-env.sh show          # each key: set or not, an 8-char fingerprint, never a value
#   fleet-env.sh seed          # fill keys MISSING from /opt/fleet/env with the value most
#                              # apps already share; never overwrites a key already there
#
# Overridable for tests (test-fleet-env.sh): FLEET_ENV, ENV_FILES, KEYS_FILE.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET_ENV="${FLEET_ENV:-/opt/fleet/env}"
KEYS_FILE="${KEYS_FILE:-$HERE/fleet-keys.conf}"
# shellcheck disable=SC2206
files=(${ENV_FILES:-/opt/*/shared/.env /opt/*/app/.env})

keys() { grep -vE '^[[:space:]]*(#|$)' "$KEYS_FILE"; }

value_of() {  # first VAR=… in a file, quotes and `export ` stripped
  sed -nE "s/^(export[[:space:]]+)?$2=//p" "$1" 2>/dev/null | head -1 \
    | sed -E 's/^["'\'']//; s/["'\'']$//; s/[[:space:]]+$//'
}

fingerprint() { printf '%s' "$1" | sha256sum | cut -c1-8; }

show() {
  local k v
  while IFS= read -r k; do
    v="$( [ -f "$FLEET_ENV" ] && value_of "$FLEET_ENV" "$k" || true)"
    if [ -n "$v" ]; then printf '%-20s set     %s\n' "$k" "$(fingerprint "$v")"
    else printf '%-20s not set\n' "$k"; fi
  done < <(keys)
}

# The value most app env files already agree on: that is the shared key.
# Placeholders ("your-key", "changeme", "xxx…") never count.
shared_value() {
  local k="$1" f v
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    [ "$f" = "$FLEET_ENV" ] && continue
    v="$(value_of "$f" "$k")"
    case "$v" in ""|*your*|*YOUR*|*changeme*|*placeholder*|xxx*|XXX*) continue ;; esac
    printf '%s\n' "$v"
  done | sort | uniq -c | sort -rn | awk 'NR==1 { $1=""; sub(/^ /, ""); print }'
}

seed() {
  install -d -m 0755 "$(dirname "$FLEET_ENV")"
  [ -f "$FLEET_ENV" ] || { umask 077; printf '# Fleet-wide shared keys (scripts/hetzner/fleet-env.sh). Values are never printed.\n' > "$FLEET_ENV"; }
  chmod 600 "$FLEET_ENV"
  local k v added=0
  while IFS= read -r k; do
    [ -n "$(value_of "$FLEET_ENV" "$k")" ] && continue
    v="$(shared_value "$k")"
    [ -n "$v" ] || continue
    printf '%s="%s"\n' "$k" "${v//\"/\\\"}" >> "$FLEET_ENV"
    echo "seeded $k ($(fingerprint "$v"))"
    added=$((added + 1))
  done < <(keys)
  echo "seeded $added key(s) into $FLEET_ENV"
}

case "${1:-show}" in
  show) show ;;
  seed) seed; show ;;
  *) echo "usage: fleet-env.sh show|seed" >&2; exit 2 ;;
esac
