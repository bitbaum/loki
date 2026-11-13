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
# (launch.sh.tmpl, load-build-env.sh) and its own .env may override it with a
# non-empty value (an empty line keeps the fleet value; FLEET_KEYS_OFF opts out).
#
# Runs ON THE BOX as ubuntu (the user every app runs as).
#
# Usage:
#   fleet-env.sh show          # each key: set or not, an 8-char fingerprint, never a value
#   fleet-env.sh seed          # fill keys MISSING from /opt/fleet/env with the value most
#                              # apps already share; never overwrites a key already there
#   fleet-env.sh secret KEY    # generate KEY (32 random bytes, hex) if the file lacks it
#   fleet-env.sh where KEY     # every env file on the box that sets KEY, by fingerprint
#   fleet-env.sh retire KEY    # switch KEY off everywhere: its line in /opt/fleet/env and in
#                              # every app env becomes a dated comment (the value is kept, so
#                              # it can be restored by hand), and the units that held it restart
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
  mkdir -p "$(dirname "$FLEET_ENV")"
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

# A key the fleet MAKES rather than collects (a signing secret): generated once,
# never replaced, never printed.
secret() {
  local k="${1:?usage: fleet-env.sh secret KEY}"
  grep -qxF "$k" < <(keys) || { echo "refused: $k is not in $(basename "$KEYS_FILE")" >&2; exit 2; }
  mkdir -p "$(dirname "$FLEET_ENV")"
  [ -f "$FLEET_ENV" ] || { umask 077; : > "$FLEET_ENV"; }
  chmod 600 "$FLEET_ENV"
  if [ -n "$(value_of "$FLEET_ENV" "$k")" ]; then echo "$k already set ($(fingerprint "$(value_of "$FLEET_ENV" "$k")"))"; return; fi
  local v; v="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
  printf '%s="%s"\n' "$k" "$v" >> "$FLEET_ENV"
  echo "generated $k ($(fingerprint "$v"))"
}

# Vendor keys only: a name that is not a credential is never touched.
key_name() {
  case "${1:-}" in
    *[!A-Z0-9_]*|"") echo "refused: not an env name: ${1:-}" >&2; exit 2 ;;
    *_KEY|*_TOKEN|*_SECRET) ;;
    *) echo "refused: $1 is not a key, token or secret" >&2; exit 2 ;;
  esac
}

holders() {  # env files that set KEY to a non-empty value, the fleet file first
  local k="$1" f
  for f in "$FLEET_ENV" "${files[@]}"; do
    [ -f "$f" ] || continue
    [ -n "$(value_of "$f" "$k")" ] && printf '%s\n' "$f"
  done | awk '!seen[$0]++'
}

where() {
  local k="${1:-}" f n=0; key_name "$k"
  while IFS= read -r f; do
    printf '%-44s %s\n' "$f" "$(fingerprint "$(value_of "$f" "$k")")"; n=$((n + 1))
  done < <(holders "$k")
  echo "$k is set in $n file(s)"
}

# 2026-11: GEMINI_API_KEY sat here as a "free tier" on a Google project that
# had billing, and every app read it: about $567 in two days. Taking a key out
# of one file left it in the others, and a running app keeps the value it
# started with, so retiring is one command that does all three.
retire() {
  local k="${1:-}" f unit n=0; key_name "$k"
  local stamp; stamp="$(date -u +%F)"
  while IFS= read -r f; do
    sed -i -E "s/^([[:space:]]*(export[[:space:]]+)?$k=)/# retired $stamp: \\1/" "$f"
    echo "retired $k in $f"; n=$((n + 1))
  done < <(holders "$k")
  echo "retired $k in $n file(s)"
  [ "${RESTART:-1}" = 1 ] || return 0
  # The fleet file feeds every app, so with it changed every app restarts;
  # one at a time, so the box never loses them together.
  local units
  if [ "$n" -gt 0 ]; then
    units="$(systemctl list-units --type=service --state=running --no-legend --plain '*-app.service' 2>/dev/null | awk '{print $1}')"
    for unit in $units; do
      sudo systemctl restart "$unit" && echo "restarted $unit" || echo "could not restart $unit" >&2
      sleep 5
    done
  fi
}

case "${1:-show}" in
  show) show ;;
  seed) seed; show ;;
  secret) secret "${2:-}" ;;
  where) where "${2:-}" ;;
  retire) retire "${2:-}" ;;
  *) echo "usage: fleet-env.sh show|seed|secret KEY|where KEY|retire KEY" >&2; exit 2 ;;
esac
