#!/usr/bin/env bash
# Box-side (root): read, test, switch on or off sealed builds for ONE runner unit.
#   sealed-builds-ctl.sh read
#   sealed-builds-ctl.sh test <unit>   # one agent build inside the container, as that unit runs it
#   sealed-builds-ctl.sh on   <unit>   # drop-in + .on flag, then drain-restart
#   sealed-builds-ctl.sh off  <unit>   # drop-in removed, then drain-restart
# Prints verdicts only, never a secret (public Action logs).
set -uo pipefail
MODE="${1:-read}"; UNIT="${2:-loki-box-runner}"; NNP="${3:-yes}"; UNIT="${UNIT%.service}"
STATE=/etc/loki/sealed-builds
unit_user() { systemctl show -p User --value "$UNIT.service"; }
unit_home() { getent passwd "$(unit_user)" | cut -d: -f6; }
unit_envfile() { systemctl show -p EnvironmentFiles --value "$UNIT.service" | awk '{print $1}'; }
restart() {
  r="loki-runner-restart-${UNIT//@/-}"
  systemctl stop "$r.service" 2>/dev/null || true; systemctl reset-failed "$r.service" 2>/dev/null || true
  systemd-run --unit="$r" --collect --quiet /bin/bash /opt/loki/runner/scripts/drain-and-restart-runner.sh "$UNIT" && echo "✓ $UNIT drain-then-restart scheduled"
}
case "$MODE" in
read)
  echo "reading:  $(tr '\n' ' ' < "$STATE" 2>/dev/null || echo none)"
  echo "runsc:    $(command -v runsc >/dev/null && runsc --version 2>/dev/null | head -1 || echo absent)"
  echo "podman:   $(podman --version 2>/dev/null || echo absent)"
  echo "image:    built=$(cat /opt/loki/agent-image/.built 2>/dev/null || echo no) want=$(sha256sum /opt/loki/runner/scripts/agent-image/Containerfile 2>/dev/null | cut -c1-12)"
  echo "on-flag:  $([ -f /etc/loki/sealed-builds.on ] && echo present || echo absent)"
  echo "units:"; systemctl list-units 'loki-box-runner*' --no-legend --plain | awk '{print "  "$1" "$4}'
  for u in $(systemctl list-units 'loki-box-runner*' --no-legend --plain | awk '{print $1}'); do
    echo "  $u user=$(systemctl show -p User --value "$u") sealed=$(systemctl show -p Environment --value "$u" | grep -o 'LOKI_EXECUTOR=[a-z]*' || echo unsealed)"
  done ;;
test)
  U="$(unit_user)"; H="$(unit_home)"; EF="$(unit_envfile)"
  [ -n "$U" ] && [ -d "$H" ] || { echo "✗ no user/home for $UNIT"; exit 1; }
  RT=""; grep -qx runsc "$STATE" 2>/dev/null && RT="--runtime runsc"
  mkdir -p "$H/.run"; chown "$U:$U" "$H/.run"; chmod 700 "$H/.run"
  proj="$H/.sealed-test"; rm -rf "$proj"; mkdir -p "$proj"; echo "# sealed test" > "$proj/README.md"; chown -R "$U:$U" "$proj"
  keyarg=()
  [ -n "$EF" ] && [ -r "$EF" ] && k="$(set -a; . "$EF" 2>/dev/null; printf %s "${GEMINI_API_KEY:-}")" && [ -n "$k" ] && keyarg=(-p "Environment=GEMINI_API_KEY=$k")
  inner='echo "inside: $(cat /proc/1/comm 2>/dev/null) uid=$(id -u) host=$(hostname)"
for a in claude codex cursor-agent grok gemini opencode; do printf "  %-13s %s\n" $a "$(command -v $a || echo missing)"; done
if cat /opt/loki/app/.env >/dev/null 2>&1; then echo "  LEAK: /opt/loki/app/.env readable"; else echo "  ✓ /opt/loki/app/.env not readable"; fi
if cat /opt/loki/runner/.env >/dev/null 2>&1; then echo "  LEAK: runner .env readable"; else echo "  ✓ /opt/loki/runner/.env not readable"; fi
[ -n "${GEMINI_API_KEY:-}" ] && { o="$(timeout 150 gemini --skip-trust -p "Append the line sealed-ok to README.md, then reply DONE" --yolo 2>&1 | tail -3)"; echo "  agent said: $(printf %s "$o" | sed -E "s/[A-Za-z0-9_-]{24,}/<masked>/g" | tr "\n" " " | cut -c1-200)"; }
echo "  README now: $(tr "\n" "|" < README.md)"'
  echo "runtime: ${RT:-default (no runsc)}"
  systemd-run --wait --pipe --quiet -p User="$U" -p NoNewPrivileges="${NNP:-yes}" -p WorkingDirectory="$proj" \
    -p Environment=XDG_RUNTIME_DIR="$H/.run" -p Environment=HOME="$H" "${keyarg[@]}" \
    podman run --rm --userns=keep-id --cgroups=disabled $RT --workdir "$proj" \
      --mount "type=bind,src=$H,dst=$H" --network slirp4netns --pids-limit 512 \
      --security-opt no-new-privileges --cap-drop ALL --env TERM=xterm-256color --env "HOME=$H" \
      --env "PATH=$H/.local/bin:$H/.npm-global/bin:/usr/local/bin:/usr/bin:/bin" --env GEMINI_API_KEY \
      localhost/loki-agent:latest bash -c "$inner" 2>&1 | sed -E 's/[A-Za-z0-9_-]{32,}/<masked>/g'
  echo "exit: ${PIPESTATUS[0]}"
  echo "images visible to $U:"; systemd-run --wait --pipe --quiet -p User="$U" -p Environment=XDG_RUNTIME_DIR="$H/.run" -p Environment=HOME="$H" podman images --format '  {{.Repository}}:{{.Tag}}' 2>&1 | grep -v level= | head -5
  ls -ld /opt/loki /opt/loki/agent-image /opt/loki/agent-image/store /opt/loki/agent-image/store/overlay-images 2>&1 | awk '{print "  "$1" "$3" "$NF}'
  systemd-run --wait --pipe --quiet -p User="$U" -p Environment=XDG_RUNTIME_DIR="$H/.run" -p Environment=HOME="$H" podman info --format '  graphRoot={{.Store.GraphRoot}} imageStores={{json .Store.GraphOptions}}' 2>&1 | grep -v level= | head -3
  echo "user storage.conf: $([ -f "$H/.config/containers/storage.conf" ] && echo present || echo none); subuid: $(grep -c "^$U:" /etc/subuid)"
  echo "host README: $(tr '\n' '|' < "$proj/README.md")" ;;
on)
  grep -qx ready "$STATE" 2>/dev/null || { echo "✗ reading is not ready — refusing"; exit 1; }
  H="$(unit_home)"; U="$(unit_user)"; D="/etc/systemd/system/$UNIT.service.d"; mkdir -p "$D" "$H/.run"; chown "$U:$U" "$H/.run"; chmod 700 "$H/.run"
  touch /etc/loki/sealed-builds.on
  { echo "[Service]"; echo "Environment=LOKI_EXECUTOR=sandbox"; echo "Environment=LOKI_SANDBOX_RUNTIME=podman"
    echo "Environment=XDG_RUNTIME_DIR=$H/.run"; grep -qx runsc "$STATE" && echo "Environment=LOKI_SANDBOX_OCI_RUNTIME=runsc"; } > "$D/sealed.conf"
  systemctl daemon-reload; echo "✓ sealed drop-in for $UNIT"; restart ;;
off)
  rm -f "/etc/systemd/system/$UNIT.service.d/sealed.conf"; systemctl daemon-reload
  [ -z "$(ls /etc/systemd/system/loki-box-runner*.d/sealed.conf 2>/dev/null)" ] && rm -f /etc/loki/sealed-builds.on
  echo "✓ $UNIT unsealed"; restart ;;
esac
