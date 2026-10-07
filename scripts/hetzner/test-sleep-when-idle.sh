#!/usr/bin/env bash
# Sleep when idle: which sites sleep, the units they get, and what sync-infra
# and the box watchdog actually send to the box for one sleeping and one
# always-on site. No box: `ssh` is a stand-in that records every command and
# its stdin, so this checks the real scripts end to end, minus the network.
# Run: bash scripts/hetzner/test-sleep-when-idle.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }

# shellcheck source=lib.sh
source "$HERE/lib.sh"
set +e

echo
echo "who sleeps: not-yet-live public sites; live clients and products stay on"
sleeping=$(grep -v '^#' "$HERE/apps.conf" | grep . | while IFS='|' read -r n p d _ _ _ _ _ s _; do
  sleeps_when_idle "$p" "$d" "$s" && printf '%s\n' "$n"
done)
for live in sink kivvi aoz-wohnen vitareba heidi solon substrata evig; do
  grep -qx "$live" <<<"$sleeping" && fail "$live is live and must stay always on"
done
ok "live sites (clients, products, evig) never sleep"
for n in $sleeping; do
  row=$(grep "^$n|" "$HERE/apps.conf")
  st=$(cut -d'|' -f9 <<<"$row")
  case " $SLEEP_WHEN_IDLE_STATUSES " in *" $st "*) ;; *) fail "$n sleeps with status '$st'";; esac
done
ok "every sleeping row has a not-yet-live status ($(wc -w <<<"$sleeping") today)"
sleeps_when_idle 4004 evig.orangecat.ch prospect && fail "handcrafted ports 4001-4004 must never sleep"
sleeps_when_idle 4050 - prospect && fail "an internal-only row has no port to wake on"
sleeps_when_idle 4050 x.example.org live && fail "live must not sleep"
sleeps_when_idle 4050 x.example.org demo || fail "a demo should sleep"
ok "handcrafted, internal-only and live rows are excluded"
[ "$(wake_inner_port 4027)" = 24027 ] || fail "inner port is +20000"
ok "inner port = port + 20000"

echo
echo "the units"
TEMPLATE=$(awk '/^  unit=\$\(cat <<EOF$/{f=1;next} f&&/^EOF$/{exit} f' "$HERE/sync-infra.sh" | sed 's/\$NAME/skif/g')
[ -n "$TEMPLATE" ] || fail "could not extract the unit template from sync-infra.sh"
U=$(sleep_app_unit "$TEMPLATE" skif 24027)
[ "$(awk '/^\[Unit\]$/{getline; print; exit}' <<<"$U")" = "BindsTo=skif-wake.service" ] || fail "BindsTo must follow [Unit]: $U"
grep -q '^OnFailure=' <<<"$(sed -n '/^\[Unit\]/,/^\[Service\]/p' <<<"$U")" || fail "OnFailure must stay in [Unit] (systemd ignores it in [Service])"
grep -q '^\[Install\]' <<<"$U" && fail "a sleeping app must have no [Install]: the socket starts at boot, not the app"
grep -qF "ExecStartPost=/bin/bash -c 'for i in \$\$(seq 1 300); do (echo > /dev/tcp/127.0.0.1/24027)" <<<"$U" \
  || fail "readiness wait must escape \$ as \$\$ for systemd and dial the inner port: $(grep ExecStartPost <<<"$U")"
ok "app unit: bound to its proxy, waits until it listens, not enabled at boot"
S=$(wake_socket_unit skif 4027); P=$(wake_proxy_unit skif 24027)
grep -qx "ListenStream=127.0.0.1:4027" <<<"$S" && grep -qx "WantedBy=sockets.target" <<<"$S" || fail "socket: $S"
grep -qx "Requires=skif-app.service" <<<"$P" && grep -qx "After=skif-app.service" <<<"$P" \
  && grep -qx "ExecStart=/usr/lib/systemd/systemd-socket-proxyd --exit-idle-time=$SLEEP_IDLE_TIME 127.0.0.1:24027" <<<"$P" \
  || fail "proxy: $P"
ok "socket holds the public port; proxy starts the app and exits after $SLEEP_IDLE_TIME idle"

# ------------------------------------------------------------- end to end
mkdir -p "$TMP/bin" "$TMP/h"
cp "$HERE"/*.sh "$HERE"/launch.sh.tmpl "$TMP/h/"
cat > "$TMP/h/apps.conf" <<'CONF'
nap|4040|nap.example.org|/dev/nap|.|-|bitbaum|client-site|prospect|-|-|-
wide|4041|wide.example.org|/dev/wide|.|-|Client|client-site|live|favour|0|-
CONF
cat > "$TMP/bin/ssh" <<'FAKE'
#!/usr/bin/env bash
log="$FAKE_SSH_LOG"
printf '=== ssh %s\n' "$*" >> "$log"
cat >> "$log" 2>/dev/null
case "$*" in *systemd-socket-proxyd\ --help*) echo "  --exit-idle-time=TIME  Exit when idle" ;; esac
exit 0
FAKE
chmod +x "$TMP/bin/ssh"
run() { PATH="$TMP/bin:$PATH" FAKE_SSH_LOG="$TMP/log" MANIFEST="$TMP/h/apps.conf" DEPLOY_KEY_PATH=/nonexistent \
          bash "$TMP/h/$1" "${@:2}" </dev/null >"$TMP/out" 2>&1; }

echo
echo "sync-infra, end to end against a recording ssh"
: > "$TMP/log"; run sync-infra.sh nap; RC=$?
[ "$RC" = 0 ] || fail "sync-infra nap failed (rc=$RC): $(cat "$TMP/out")"
L=$(cat "$TMP/log")
grep -q "PORT=24040" <<<"$L" || fail "a sleeping app's launch.sh must listen on the inner port"
grep -q "ListenStream=127.0.0.1:4040" <<<"$L" || fail "its socket must hold the public port"
grep -q "BindsTo=nap-wake.service" <<<"$L" || fail "its app unit must bind to the proxy"
grep -q "systemctl enable --now nap-wake.socket" <<<"$L" || fail "the socket must be enabled and started"
grep -q "systemctl disable nap-app" <<<"$L" || fail "the app must no longer start at boot"
grep -q "nap|wake:nap|socket" <<<"$L" || fail "the watchdog must check nap's socket, not request it"
grep -q "https://nap.example.org" <<<"$L" && fail "the watchdog must not request a sleeping site every 5 minutes"
ok "sleeping site: inner port, socket on :4040, bound app, watchdog checks the socket"

: > "$TMP/log"; run sync-infra.sh wide; RC=$?
[ "$RC" = 0 ] || fail "sync-infra wide failed (rc=$RC): $(cat "$TMP/out")"
L=$(cat "$TMP/log")
grep -q "PORT=4041" <<<"$L" || fail "an always-on app listens on its own port"
grep -q "wake.socket >/dev/null <<" <<<"$L" && fail "an always-on app must get no wake units"
grep -q "systemctl enable wide-app" <<<"$L" || fail "an always-on app is enabled at boot as before"
grep -q "WantedBy=multi-user.target" <<<"$L" || fail "an always-on unit keeps its [Install]"
grep -q "wide|https://wide.example.org|200" <<<"$L" || fail "the watchdog still requests a live site"
grep -q "rm -f /etc/systemd/system/wide-wake.socket" <<<"$L" || fail "a site that went live must have stale wake units removed"
ok "live site: unchanged, plus clean-up if it used to sleep"

echo
echo "no socket-proxyd idle support on the box → nothing sleeps"
cat > "$TMP/bin/ssh" <<'FAKE'
#!/usr/bin/env bash
printf '=== ssh %s\n' "$*" >> "$FAKE_SSH_LOG"; cat >> "$FAKE_SSH_LOG" 2>/dev/null; exit 0
FAKE
: > "$TMP/log"; run sync-infra.sh nap
grep -q "PORT=4040" "$TMP/log" && ! grep -q "wake.socket >/dev/null <<" "$TMP/log" || fail "without --exit-idle-time the site must stay always on"
grep -q "no site will sleep" "$TMP/out" || fail "and say so"
ok "falls back to always on, out loud"

grep -q '`' "$HERE/sync-infra.sh" && fail "sync-infra.sh contains a backtick"
ok "sync-infra.sh has no backticks"

echo
echo "$PASSED passed"
