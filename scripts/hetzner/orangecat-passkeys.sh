#!/usr/bin/env bash
#
# Passkeys at OrangeCat's auth server (GoTrue in the self-hosted Supabase).
#
# WHY
# ---
# OrangeCat's code offers passkeys end to end and hides them while GoTrue's
# public settings say `passkeys_enabled: false` (orangecat
# docs/operations/passkeys.md). Nothing reached the box to say otherwise:
# GoTrue's env lives in /opt/supabase/docker, which no workflow wrote
# (orangecat#1533). This is that switch, and nothing more: four variables,
# the auth container recreated, the public settings read back.
#
# The relying-party id is the domain passkeys are bound to. A passkey made for
# one id never works for another, so it is fixed here, once: orangecat.ch,
# the page that runs the ceremony, not supabase.orangecat.ch.
#
# Runs ON THE BOX (sudo for /opt/supabase). Prints names and verdicts, never
# a value from .env.
#
# Usage:
#   orangecat-passkeys.sh show       # what is set, where; changes nothing
#   orangecat-passkeys.sh apply      # set the four, recreate auth, read back
#   orangecat-passkeys.sh rollback   # PASSKEY_ENABLED=false, recreate, read back
#
# Overridable for tests (test-orangecat-passkeys.sh): SUPABASE_DIR, DOCKER,
# SETTINGS_URL, SUDO.
set -euo pipefail

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase/docker}"
COMPOSE="$SUPABASE_DIR/docker-compose.yml"
ENV_FILE="$SUPABASE_DIR/.env"
DOCKER="${DOCKER:-docker}"
SUDO="${SUDO-sudo}"
SETTINGS_URL="${SETTINGS_URL:-https://supabase.orangecat.ch/auth/v1/settings}"
MARK="# orangecat passkeys (loki scripts/hetzner/orangecat-passkeys.sh)"

KEYS=(GOTRUE_PASSKEY_ENABLED GOTRUE_WEBAUTHN_RP_ID GOTRUE_WEBAUTHN_RP_DISPLAY_NAME GOTRUE_WEBAUTHN_RP_ORIGINS)
declare -A WANT=(
  [GOTRUE_PASSKEY_ENABLED]=true
  [GOTRUE_WEBAUTHN_RP_ID]=orangecat.ch
  [GOTRUE_WEBAUTHN_RP_DISPLAY_NAME]=OrangeCat
  # www.orangecat.ch serves the site too (200, no redirect, 2026-11-02), and a
  # ceremony there needs its origin listed; the RP id covers the subdomain.
  [GOTRUE_WEBAUTHN_RP_ORIGINS]=https://orangecat.ch,https://www.orangecat.ch
)

die() { echo "✗ $*" >&2; exit 1; }

# The compose service whose image is GoTrue (`auth` in Supabase's own file).
auth_service() {
  $SUDO awk '
    /^services:/ { in_s = 1; next }
    in_s && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { svc = $1; sub(":", "", svc) }
    in_s && /^    image:/ && /gotrue|supabase\/auth/ { print svc; exit }
  ' "$COMPOSE"
}

# Lines of one service's block.
service_block() {
  $SUDO awk -v s="$1" '
    $0 ~ "^  " s ":[[:space:]]*$" { on = 1; print; next }
    on && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { exit }
    on { print }
  ' "$COMPOSE"
}

env_has() { $SUDO grep -qE "^$1=" "$ENV_FILE"; }
env_is() { $SUDO grep -qxE "$1=[\"']?$2[\"']?" "$ENV_FILE"; }

passkeys_enabled() {
  local key
  key=$($SUDO sed -nE 's/^ANON_KEY=["'\'']?([^"'\'']+).*/\1/p' "$ENV_FILE" | head -1)
  [ -n "$key" ] || { echo "unknown"; return; }
  # A restarting auth server answers 5xx for a few seconds: that is "not yet",
  # never a reason to stop (set -e and pipefail would otherwise end the run).
  local body
  body=$(curl -fsS -m 15 "$SETTINGS_URL" -H "apikey: $key" 2>/dev/null) || body=""
  sed -nE 's/.*"passkeys_enabled":(true|false).*/\1/p' <<<"$body" | head -1
}

show() {
  [ -f "$COMPOSE" ] || $SUDO test -f "$COMPOSE" || die "no $COMPOSE"
  local svc; svc=$(auth_service)
  [ -n "$svc" ] || die "no GoTrue service in $COMPOSE"
  echo "auth service: $svc ($(service_block "$svc" | sed -nE 's/^    image:[[:space:]]*//p'))"
  local block; block=$(service_block "$svc")
  for k in "${KEYS[@]}"; do
    local in_env=no in_compose=no
    env_has "$k" && in_env=yes
    grep -qE "^      $k:" <<<"$block" && in_compose=yes
    echo "  $k: .env=$in_env compose=$in_compose"
  done
  echo "passkeys_enabled (public settings): $(passkeys_enabled)"
}

set_env() {  # key value: replace the line, or append it
  local tmp; tmp=$(mktemp)
  $SUDO cat "$ENV_FILE" | grep -vE "^$1=" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  $SUDO cp "$tmp" "$ENV_FILE"; rm -f "$tmp"
}

wire_compose() {  # each key passed through to the auth container, once
  local svc="$1" missing=() k block
  block=$(service_block "$svc")
  for k in "${KEYS[@]}"; do
    grep -qE "^      $k:" <<<"$block" || missing+=("$k")
  done
  [ ${#missing[@]} -eq 0 ] && return 0
  grep -qE '^    environment:[[:space:]]*$' <<<"$block" \
    || die "the $svc service has no 'environment:' map to extend"
  $SUDO cp "$COMPOSE" "$COMPOSE.bak-passkeys-$(date +%Y%m%d%H%M%S)"
  local lines="      $MARK"
  for k in "${missing[@]}"; do lines+=$'\n'"      $k: \${$k}"; done
  local tmp; tmp=$(mktemp)
  $SUDO awk -v s="$svc" -v add="$lines" '
    $0 ~ "^  " s ":[[:space:]]*$" { on = 1 }
    on && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ && $0 !~ "^  " s ":" { on = 0 }
    { print }
    on && !done && /^    environment:[[:space:]]*$/ { print add; done = 1 }
  ' "$COMPOSE" > "$tmp"
  $SUDO cp "$tmp" "$COMPOSE"; rm -f "$tmp"
  echo "wired into compose: ${missing[*]}"
}

recreate() {
  (cd "$SUPABASE_DIR" && $SUDO $DOCKER compose up -d --no-deps --force-recreate "$1") >/dev/null
  echo "recreated $1"
}

read_back() {  # want: true|false
  local got=""
  for _ in $(seq 1 20); do
    got=$(passkeys_enabled)
    [ "$got" = "$1" ] && { echo "✓ passkeys_enabled=$got"; return 0; }
    sleep 3
  done
  die "passkeys_enabled reads '$got', wanted $1"
}

apply() {
  local svc; svc=$(auth_service); [ -n "$svc" ] || die "no GoTrue service in $COMPOSE"
  $SUDO cp "$ENV_FILE" "$ENV_FILE.bak-passkeys-$(date +%Y%m%d%H%M%S)"
  for k in "${KEYS[@]}"; do
    # An RP id already set to something else is someone's decision: never move it.
    if [ "$k" = GOTRUE_WEBAUTHN_RP_ID ] && env_has "$k" && ! env_is "$k" "${WANT[$k]}"; then
      die "$k is already set to another value; passkeys made for it would be stranded"
    fi
    set_env "$k" "${WANT[$k]}"
  done
  wire_compose "$svc"
  recreate "$svc"
  read_back true
}

rollback() {
  local svc; svc=$(auth_service); [ -n "$svc" ] || die "no GoTrue service in $COMPOSE"
  set_env GOTRUE_PASSKEY_ENABLED false
  recreate "$svc"
  read_back false
}

case "${1:-show}" in
  show) show ;;
  apply) apply ;;
  rollback) rollback ;;
  *) die "usage: $0 show|apply|rollback" ;;
esac
