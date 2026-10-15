#!/usr/bin/env bash
# Bring the OpenClaw gateway back and make it stay back.
#
# WHY THIS EXISTS. WhatsApp and the Telegram chat are both carried by the
# OpenClaw gateway on bitbaum — Loki has no inbound channel of its own. On
# 2026-10-15 the messaging doctor (doctor-messaging.sh) found it dead since
# 2026-10-08: no process, nothing on :18789, the unit `disabled`, and the
# openclaw user's systemd manager unreachable ("Failed to connect to user scope
# bus"). Forwarding a message to WhatsApp to be put in the calendar had stopped
# working and nothing said so — the health sweep had stopped watching the
# gateway the same day, on the belief that it was retired. It was not.
#
# What it does, and only this (each step prints what it found first):
#   1. enable-linger for the openclaw user. Without linger the user's systemd
#      manager exists only while someone is logged in, so a reboot (the box
#      patches itself) left the gateway down for good. This is the cause.
#   2. enable + start ~openclaw/.config/systemd/user/openclaw-gateway.service,
#      the unit `openclaw gateway install` wrote. `enable` is what makes it
#      come back after the next reboot.
#   3. wait for the gateway to answer on :18789, then print the CLI's channel
#      status (masked) so the WhatsApp/Telegram state is on the record.
#
# It does NOT touch the gateway's config, its WhatsApp credentials, its
# Telegram token, or any other unit. If WhatsApp's linked-device session has
# been logged out it cannot fix that — a QR scan is the one step only the
# phone's owner can do — and it says so rather than guessing.
#
# Run from GitHub Actions: .github/workflows/openclaw-gateway-up.yml, piped to
# `bash -s` on the box as root. Repo is PUBLIC: nothing secret or personal is
# printed; every line passes through red().
set -u

red() { sed -E 's/[0-9]{7,}/<n>/g; s/[A-Za-z0-9_-]{24,}/<redacted>/g' | cut -c1-220; }
hr() { printf '\n=== %s ===\n' "$1"; }

UNIT=openclaw-gateway.service
uid="$(id -u openclaw 2>/dev/null)" || { echo "✗ no openclaw user on this box"; exit 1; }
RT="/run/user/$uid"
as_oc() {
  runuser -u openclaw -- env XDG_RUNTIME_DIR="$RT" DBUS_SESSION_BUS_ADDRESS="unix:path=$RT/bus" "$@"
}
gw_http() { curl -s -o /dev/null -m 4 -w '%{http_code}' http://127.0.0.1:18789/ 2>/dev/null || echo 000; }

hr "before"
echo "linger: $(loginctl show-user openclaw -p Linger 2>/dev/null | cut -d= -f2)"
echo "user manager bus: $([ -S "$RT/bus" ] && echo present || echo ABSENT)"
echo "unit file: $([ -f /home/openclaw/.config/systemd/user/$UNIT ] && echo present || echo MISSING)"
echo "gateway processes: $(pgrep -u openclaw -f 'gateway' 2>/dev/null | wc -l)"
echo "HTTP :18789 -> $(gw_http)"
if [ ! -f "/home/openclaw/.config/systemd/user/$UNIT" ]; then
  echo "✗ the unit file is gone — re-create it with: sudo -iu openclaw openclaw gateway install --bind loopback"
  exit 1
fi

hr "1. linger"
loginctl enable-linger openclaw && echo "enabled (the user manager now starts at boot and stays up)"
for i in $(seq 1 20); do [ -S "$RT/bus" ] && break; sleep 1; done
if [ ! -S "$RT/bus" ]; then
  echo "✗ the user manager did not come up (no $RT/bus after 20s)"
  systemctl status "user@${uid}.service" --no-pager 2>&1 | head -12 | red
  exit 1
fi
echo "user manager bus: present"

hr "2. enable and start $UNIT"
as_oc systemctl --user daemon-reload
as_oc systemctl --user enable --now "$UNIT" 2>&1 | red
echo "is-enabled: $(as_oc systemctl --user is-enabled "$UNIT" 2>&1)"
echo "is-active:  $(as_oc systemctl --user is-active "$UNIT" 2>&1)"

hr "3. wait for the gateway"
up=""
for i in $(seq 1 30); do
  code="$(gw_http)"
  case "$code" in [1-5][0-9][0-9]) up="$code"; break ;; esac
  sleep 2
done
if [ -n "$up" ]; then
  echo "gateway answering: HTTP $up on :18789 (after ~$((i * 2))s)"
else
  echo "✗ the gateway did not answer within 60s"
  echo "-- its unit's last lines (masked):"
  as_oc journalctl --user -u "$UNIT" -n 25 --no-pager -q 2>&1 | red
  [ -f /home/openclaw/.openclaw/logs/gateway.log ] && { echo "-- gateway.log tail (masked):"; tail -n 15 /home/openclaw/.openclaw/logs/gateway.log | red; }
  exit 1
fi

hr "4. what the gateway says about its channels (masked)"
sleep 8   # WhatsApp/Telegram connect a few seconds after the port opens
printf '%s\n' \
  '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc" >/dev/null 2>&1 || true' \
  'command -v openclaw >/dev/null 2>&1 || for d in "$HOME"/.nvm/versions/node/*/bin "$HOME"/.npm-global/bin "$HOME"/.local/bin /usr/local/bin; do [ -x "$d/openclaw" ] && PATH="$d:$PATH" && break; done' \
  'command -v openclaw >/dev/null 2>&1 || { echo "no openclaw CLI on PATH"; exit 0; }' \
  'echo "$ openclaw channels status"; timeout 30 openclaw channels status 2>&1 | head -30' \
  | runuser -u openclaw -- env XDG_RUNTIME_DIR="$RT" bash -ls 2>&1 | red

echo
echo "-- channel lines in the gateway log since start (masked, errors and connection events only):"
tail -n 200 /home/openclaw/.openclaw/logs/gateway.log 2>/dev/null \
  | grep -iE 'whatsapp|telegram' | grep -iE 'connect|ready|logged|login|qr|error|fail|conflict|start|open|close' | tail -12 | red

hr "after"
echo "linger: $(loginctl show-user openclaw -p Linger 2>/dev/null | cut -d= -f2)"
echo "enabled at boot: $(as_oc systemctl --user is-enabled "$UNIT" 2>&1)"
echo "gateway processes: $(pgrep -u openclaw -f 'gateway' 2>/dev/null | wc -l)"
echo "HTTP :18789 -> $(gw_http)"
echo
echo "openclaw-gateway-up: done."
