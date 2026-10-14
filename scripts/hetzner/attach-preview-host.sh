#!/usr/bin/env bash
#
# Give a prospect preview its own address: <label>.orangecat.ch.
#
#   attach-preview-host.sh <label> [--dry-run]
#   attach-preview-host.sh <label> --detach [--dry-run]
#
# A preview is a folder served by Loki at /p/<label>/ behind the access code
# (docs/architecture/prospect-previews.md). This makes the same preview the
# whole of <label>.orangecat.ch, so what a prospect is sent reads like their
# own site, and moving it to their own domain later is attach-domain.sh and
# nothing else.
#
# Wildcard DNS (*.orangecat.ch) already points every label at the box, so there
# is no record to set. The vhost (lib.sh, preview_vhost) is the public switch,
# and Caddy fetches the certificate the first time the host is asked for.
#
# Refuses a label that is reserved, malformed, or already some other site's
# host. Idempotent. Prints LIVE_URL=<url> as its last line for the app.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$HERE/lib.sh"

LABEL=""; DETACH=0; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --detach)  DETACH=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) [ -z "$LABEL" ] || { echo "unexpected arg: $1" >&2; exit 2; }; LABEL="$1"; shift ;;
  esac
done
[ -n "$LABEL" ] || { echo "usage: attach-preview-host.sh <label> [--detach]" >&2; exit 2; }
[[ "$LABEL" =~ ^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$ ]] || { echo "refused: '$LABEL' is not a valid address label" >&2; exit 1; }

BASE="$SITES_BASE_DOMAIN"
HOST="$LABEL.$BASE"
PORT="${LOKI_APP_PORT:-4002}"
FILE="/etc/caddy/apps.d/preview-$LABEL.caddy"

if [ "$DETACH" = 1 ]; then
  if [ "$DRY" = 1 ]; then echo "would remove $FILE"; exit 0; fi
  box "sudo rm -f $FILE && sudo caddy validate --config /etc/caddy/Caddyfile >/dev/null && sudo systemctl reload caddy"
  echo "detached $HOST"
  exit 0
fi

# Reserved labels and anything the register already serves: a preview must not
# shadow, or be shadowed by, a real site. The register's own rows are the SSOT.
case "$LABEL" in
  www|api|app|admin|loki|bridge|mail|smtp|imap|ns1|ns2|mx|login|auth|account|billing|pay|wallet|support|security|p)
    echo "refused: '$LABEL' is reserved" >&2; exit 1 ;;
esac
if grep -v '^#' "$MANIFEST" | cut -d'|' -f3 | tr ',' '\n' | grep -qx "$HOST"; then
  echo "refused: $HOST is already a registered site" >&2; exit 1
fi

VHOST="$(preview_vhost "$LABEL" "$HOST" "$PORT")"
if [ "$DRY" = 1 ]; then printf '%s\n' "$VHOST"; echo "LIVE_URL=https://$HOST/"; exit 0; fi

box "sudo mkdir -p /etc/caddy/apps.d && sudo tee $FILE >/dev/null <<'CADDY_EOF'
$VHOST
CADDY_EOF"
box 'sudo caddy validate --config /etc/caddy/Caddyfile >/dev/null && sudo systemctl reload caddy && echo "caddy reloaded OK"'
echo "LIVE_URL=https://$HOST/"
