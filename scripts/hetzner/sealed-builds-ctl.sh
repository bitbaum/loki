#!/usr/bin/env bash
# Box-side (root): read, test, switch on or off sealed builds for ONE runner unit.
#   sealed-builds-ctl.sh read
#   sealed-builds-ctl.sh test <unit>   # one agent build inside the container, as that unit runs it
#   sealed-builds-ctl.sh on   <unit>   # drop-in + .on flag, then drain-restart
#   sealed-builds-ctl.sh off  <unit>   # drop-in removed, then drain-restart
# Prints verdicts only, never a secret (public Action logs).
set -uo pipefail
MODE="${1:-read}"; UNIT="${2:-loki-box-runner}"; UNIT="${UNIT%.service}"
STATE=/etc/loki/sealed-builds
unit_user() { systemctl show -p User --value "$UNIT.service"; }
unit_home() { getent passwd "$(unit_user)" | cut -d: -f6; }
unit_envfile() { systemctl show -p EnvironmentFiles --value "$UNIT.service" | awk '{print $1}'; }
restart() {
  r="loki-runner-restart-${UNIT//@/-}"
  systemctl stop "$r.service" 2>/dev/null || true; systemctl reset-failed "$r.service" 2>/dev/null || true
  systemd-run --unit="$r" --collect --quiet /bin/bash /opt/loki/runner/scripts/drain-and-restart-runner.sh "$UNIT" && echo "✓ $UNIT drain-then-restart scheduled"
}
ensure_image() { # <user> <home>
  local t=/tmp/loki-agent-image.tar
  CONTAINERS_STORAGE_CONF=/opt/loki/agent-image/storage.conf podman save -q -o "$t" loki-agent:latest 2>&1 | tail -2
  chmod 644 "$t"
  systemd-run --wait --pipe --quiet -p User="$1" -p Environment=XDG_RUNTIME_DIR="$2/.run" -p Environment=HOME="$2" \
    podman load -q -i "$t" 2>&1 | grep -v level= | tail -2
  rm -f "$t"
}
case "$MODE" in
matrix)
  command -v crun >/dev/null || apt-get install -y -qq crun >/dev/null 2>&1; echo "crun: $(crun --version 2>/dev/null | head -1 || echo absent)"
  U="$(unit_user)"; H="$(unit_home)"; mkdir -p "$H/.run"; chown "$U:$U" "$H/.run"
  ensure_image "$U" "$H"
  for nnp in yes no; do for rt in runsc crun; do for cg in disabled enabled; do
    extra=""; [ "$rt" = runsc ] && extra="--runtime-flag ignore-cgroups"
    o="$(systemd-run --wait --pipe --quiet -p User="$U" -p NoNewPrivileges=$nnp -p Environment=XDG_RUNTIME_DIR="$H/.run" -p Environment=HOME="$H" \
      podman run --rm --userns=keep-id --cgroups=$cg --runtime $rt $extra --network slirp4netns --security-opt no-new-privileges --cap-drop ALL \
      --mount "type=bind,src=$H,dst=$H" loki-agent:latest bash -c 'echo OK uid=$(id -u) $(cat /opt/loki/app/.env >/dev/null 2>&1 && echo LEAK || echo sealed)' 2>&1 | grep -v level=warn | tail -1 | cut -c1-140)"
    echo "nnp=$nnp rt=$rt cgroups=$cg -> $o"
  done; done; done ;;
diag)
  # Runner journal for the given run ids + gemini under a real PTY inside the
  # sealed container, with and without -t. RUNS: space-separated ids (env).
  U="$(unit_user)"; H="$(unit_home)"; EF="$(unit_envfile)"
  echo "unit env: $(systemctl show -p Environment --value "$UNIT.service" | tr ' ' '\n' | grep -o '^LOKI_[A-Z_]*=[a-z0-9]*' | tr '\n' ' ')"
  echo "runner version: $(cat /opt/loki/runner/package.json 2>/dev/null | grep -m1 '"version"')"
  echo "gemini on host: $(sudo -u "$U" bash -lc 'gemini --version' 2>&1 | tail -1); ~/.gemini: $(ls -A "$H/.gemini" 2>/dev/null | tr '\n' ' ' | cut -c1-200)"
  echo "GEMINI_API_KEY in env file: $([ -n "$EF" ] && grep -q '^GEMINI_API_KEY=.' "$EF" && echo yes || echo no)"
  echo "--- journal (masked) ---"
  pat="$(echo "${RUNS:-x}" | tr ' ' '|')"
  journalctl -u "$UNIT" --since "-4h" --no-pager -o short-iso 2>/dev/null | grep -Ei "$pat|gemini|antigravity|sandbox|podman|never accepted" \
    | sed -E 's/[A-Za-z0-9_-]{28,}/<masked>/g' | cut -c1-400 | tail -120
  echo "--- PTY repro ---"
  RT=""; [ -f /etc/loki/sealed-builds.on ] && grep -qx runsc "$STATE" 2>/dev/null && RT="--runtime runsc --runtime-flag ignore-cgroups"
  proj="$H/.sealed-test"; mkdir -p "$proj"; echo "# sealed test" > "$proj/README.md"; chown -R "$U:$U" "$proj"; mkdir -p "$H/.run"; chown "$U:$U" "$H/.run"
  ensure_image "$U" "$H"
  chmod 755 /tmp/sealed-pty-probe.py
  keyenv=(); [ -n "$EF" ] && k="$(set -a; . "$EF" 2>/dev/null; printf %s "${GEMINI_API_KEY:-}")" && [ -n "$k" ] && keyenv=(-p "Environment=GEMINI_API_KEY=$k")
  for tflag in "-it"; do
    echo "podman run $tflag ($RT):"
    systemd-run --wait --pipe --quiet -p User="$U" -p NoNewPrivileges=no -p WorkingDirectory="$proj" \
      -p Environment=XDG_RUNTIME_DIR="$H/.run" -p Environment=HOME="$H" -p Environment=PATH=/usr/local/bin:/usr/bin:/bin "${keyenv[@]}" -p 'Environment="PROBE_PROMPT=Run the shell command sleep 8, then list the files here, then append a haiku to README.md."' \
      python3 /tmp/sealed-pty-probe.py 50 -- podman run --rm $tflag --userns=keep-id $RT --workdir "$proj" \
        --mount "type=bind,src=$H,dst=$H" --network slirp4netns --pids-limit 512 --security-opt no-new-privileges --cap-drop ALL \
        --env TERM=xterm-256color --env "HOME=$H" --env "PATH=$H/.local/bin:$H/.npm-global/bin:/usr/local/bin:/usr/bin:/bin" --env GEMINI_API_KEY \
        loki-agent:latest gemini --skip-trust --yolo 2>&1 | sed -E 's/[A-Za-z0-9_-]{32,}/<masked>/g'
  done ;;
stop-sealed)
  # Stop the unit's sealed agent containers (fc-ws-*) so a waiting restart can
  # proceed. Only for a stuck session; the runner sees the PTY exit and closes
  # the run as Failed with the cause (and salvages its work into a draft PR).
  U="$(unit_user)"; H="$(unit_home)"
  for c in $(systemd-run --wait --pipe --quiet -p User="$U" -p Environment=XDG_RUNTIME_DIR="$H/.run" -p Environment=HOME="$H" podman ps --format '{{.Names}}' 2>/dev/null | grep '^fc-ws-'); do
    echo "stopping $c"
    systemd-run --wait --pipe --quiet -p User="$U" -p Environment=XDG_RUNTIME_DIR="$H/.run" -p Environment=HOME="$H" podman stop -t 10 "$c" 2>&1 | grep -v level= | tail -1
  done
  journalctl -t loki-drain --since -30min --no-pager -o short-iso 2>/dev/null | tail -5 ;;
containers)
  U="$(unit_user)"; H="$(unit_home)"
  systemd-run --wait --pipe --quiet -p User="$U" -p Environment=XDG_RUNTIME_DIR="$H/.run" -p Environment=HOME="$H" podman ps -a --format '  {{.Names}} {{.Status}} {{.Created}}' 2>&1 | grep -v level= ;;
journal)
  pat="$(echo "${RUNS:-x}" | tr ' ' '|')"
  { journalctl -u "$UNIT" --since "-1h" --no-pager -o short-iso; journalctl -t loki-drain --since "-1h" --no-pager -o short-iso; } 2>/dev/null | sort | grep -Ei "$pat" \
    | sed -E 's/[A-Za-z0-9_-]{28,}/<masked>/g' | cut -c1-400 | tail -${JTAIL:-600} || true ;;
worktree)
  # Read-only: branch, status and diff of the run worktrees named in RUNS.
  H="$(unit_home)"
  for r in ${RUNS:-}; do
    ls -d "$H"/.loki/worktrees/*"$r"* 2>/dev/null | sed 's/^/  dir: /'
    for d in $(find "$H/.loki/worktrees" "$H/dev" -maxdepth 4 -name .git -printf '%h\n' 2>/dev/null); do
      b="$(sudo -u "$(unit_user)" git -C "$d" -c safe.directory='*' branch --show-current 2>/dev/null)"
      case "$d $b" in *"$r"*) ;; *) continue ;; esac
      echo "=== $d"
      sudo -u "$(unit_user)" git -C "$d" -c safe.directory='*' log -1 --format='head: %h %s' 2>&1
      sudo -u "$(unit_user)" git -C "$d" -c safe.directory='*' status -sb 2>&1 | head -20
      sudo -u "$(unit_user)" git -C "$d" -c safe.directory='*' diff HEAD 2>&1 | head -200
    done
  done ;;
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
  CG="--cgroups=disabled"; [ -n "$RT" ] && CG="--runtime-flag ignore-cgroups"
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
  # Rootless podman does not see root's shared store (0700, imageStores={}),
  # so hand the user its own copy of the image: root saves, the user loads.
  ensure_image "$U" "$H"
  echo "runtime: ${RT:-default (no runsc)} $CG; unit NoNewPrivileges=no (as the sealed drop-in sets it)"
  systemd-run --wait --pipe --quiet -p User="$U" -p NoNewPrivileges=no -p WorkingDirectory="$proj" \
    -p Environment=XDG_RUNTIME_DIR="$H/.run" -p Environment=HOME="$H" "${keyarg[@]}" \
    podman run --rm --userns=keep-id $CG $RT --workdir "$proj" \
      --mount "type=bind,src=$H,dst=$H" --network slirp4netns --pids-limit 512 \
      --security-opt no-new-privileges --cap-drop ALL --env TERM=xterm-256color --env "HOME=$H" \
      --env "PATH=$H/.local/bin:$H/.npm-global/bin:/usr/local/bin:/usr/bin:/bin" --env GEMINI_API_KEY \
      loki-agent:latest bash -c "$inner" 2>&1 | sed -E 's/[A-Za-z0-9_-]{32,}/<masked>/g'
  echo "exit: ${PIPESTATUS[0]}"
  echo "images visible to $U:"; systemd-run --wait --pipe --quiet -p User="$U" -p Environment=XDG_RUNTIME_DIR="$H/.run" -p Environment=HOME="$H" podman images --format '  {{.Repository}}:{{.Tag}}' 2>&1 | grep -v level= | head -5
  ls -ld /opt/loki /opt/loki/agent-image /opt/loki/agent-image/store /opt/loki/agent-image/store/overlay-images 2>&1 | awk '{print "  "$1" "$3" "$NF}'
  systemd-run --wait --pipe --quiet -p User="$U" -p Environment=XDG_RUNTIME_DIR="$H/.run" -p Environment=HOME="$H" podman info --format '  graphRoot={{.Store.GraphRoot}} imageStores={{json .Store.GraphOptions}}' 2>&1 | grep -v level= | head -3
  echo "user storage.conf: $([ -f "$H/.config/containers/storage.conf" ] && echo present || echo none); subuid: $(grep -c "^$U:" /etc/subuid)"
  echo "host README: $(tr '\n' '|' < "$proj/README.md")" ;;
on)
  grep -qx ready "$STATE" 2>/dev/null || { echo "✗ reading is not ready — refusing"; exit 1; }
  H="$(unit_home)"; U="$(unit_user)"; D="/etc/systemd/system/$UNIT.service.d"; mkdir -p "$D" "$H/.run"; chown "$U:$U" "$H/.run"; chmod 700 "$H/.run"
  ensure_image "$U" "$H"
  touch /etc/loki/sealed-builds.on
  { echo "[Service]"; echo "Environment=LOKI_EXECUTOR=sandbox"; echo "Environment=LOKI_SANDBOX_RUNTIME=podman"
    echo "NoNewPrivileges=no"; echo "Environment=XDG_RUNTIME_DIR=$H/.run"; grep -qx runsc "$STATE" && echo "Environment=LOKI_SANDBOX_OCI_RUNTIME=runsc"; } > "$D/sealed.conf"
  systemctl daemon-reload; echo "✓ sealed drop-in for $UNIT"; restart ;;
off)
  rm -f "/etc/systemd/system/$UNIT.service.d/sealed.conf"; systemctl daemon-reload
  [ -z "$(ls /etc/systemd/system/loki-box-runner*.d/sealed.conf 2>/dev/null)" ] && rm -f /etc/loki/sealed-builds.on
  echo "✓ $UNIT unsealed"; restart ;;
esac
