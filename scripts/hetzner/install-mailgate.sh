#!/usr/bin/env bash
#
# Install or update loki-mailgate ON THE BOX: the receiving side of the fleet's
# email standard (hello@<app host>, see mailgate/README.md). Idempotent.
#
# Expects, next to this script in /opt/mailgate/install/ (the Mailgate
# workflow copies them): mailgate.mjs (the bundle), loki-mailgate.service,
# apps.conf, fleet-env.sh and fleet-keys.conf.
#
# What it does, once each:
#   - makes MAIL_INBOUND_SECRET in /opt/fleet/env (never printed, never replaced)
#   - makes a private TLS key + certificate for STARTTLS (never smtp-server's
#     built-in one, whose private key is public)
#   - installs the bundle, the register copy and the systemd unit
#   - opens 25/tcp in ufw and (re)starts the service
#   - refuses if something other than mailgate already listens on :25
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR=/opt/mailgate

holder="$(sudo ss -ltnpH 'sport = :25' 2>/dev/null | grep -v mailgate || true)"
if [ -n "$holder" ] && ! systemctl is-active --quiet loki-mailgate; then
  echo "refused: something else already listens on :25 — $holder" >&2
  exit 1
fi

# mkdir + chown, not `install -d -m`: the box's coreutils (the Rust one)
# fails that chmod with EPERM even under sudo (Fleet env run, 2026-10-22).
sudo mkdir -p "$DIR/tls" "$DIR/spool"
sudo chown ubuntu:ubuntu "$DIR" "$DIR/tls" "$DIR/spool"
chmod 0700 "$DIR/spool"

bash "$SRC/fleet-env.sh" secret MAIL_INBOUND_SECRET

if [ ! -s "$DIR/tls/key.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=mx.orangecat.ch" \
    -keyout "$DIR/tls/key.pem" -out "$DIR/tls/cert.pem" 2>/dev/null
  chmod 600 "$DIR/tls/key.pem"
  echo "made a TLS key for STARTTLS"
fi

cp "$SRC/mailgate.mjs" "$DIR/mailgate.mjs"
cp "$SRC/apps.conf" "$DIR/apps.conf"
sudo cp "$SRC/loki-mailgate.service" /etc/systemd/system/loki-mailgate.service
sudo systemctl daemon-reload

if command -v ufw >/dev/null && ! sudo ufw status | grep -qE '^25/tcp +ALLOW'; then
  sudo ufw allow 25/tcp comment 'loki-mailgate: mail for the apps' >/dev/null
  echo "opened 25/tcp"
fi

sudo systemctl enable --quiet loki-mailgate
sudo systemctl restart loki-mailgate
for _ in $(seq 1 20); do
  sudo ss -ltnH 'sport = :25' | grep -q . && break
  sleep 0.5
done
systemctl is-active --quiet loki-mailgate || { sudo journalctl -u loki-mailgate -n 30 --no-pager; exit 1; }
sudo ss -ltnH 'sport = :25' | grep -q . || { echo "loki-mailgate is running but not listening on :25" >&2; exit 1; }
echo "loki-mailgate: listening on :25 for $(grep -cvE '^[[:space:]]*(#|$)' "$DIR/apps.conf") registered sites"
