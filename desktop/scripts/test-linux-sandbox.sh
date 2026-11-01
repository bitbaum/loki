#!/usr/bin/env bash
#
# Packaged-build test for the Linux Chromium sandbox.
#
#   desktop/scripts/test-linux-sandbox.sh <Fleet-Runner-*.AppImage> sandboxed|fallback
#
# Starts the real AppImage (under Xvfb, with --appimage-extract-and-run so no
# FUSE is needed) and inspects the live process tree:
#
#   sandboxed  the main process has no --no-sandbox, and a renderer runs in
#              its own user namespace under seccomp-bpf (Seccomp: 2): the
#              namespace sandbox is really on.
#   fallback   the machine blocks unprivileged user namespaces; the app must
#              still start, with --no-sandbox, and print why on stderr.
#
# It also checks, before launching, that the packaged launcher is exactly
# desktop/scripts/linux-launcher.sh and that the .desktop entry does not
# pass --no-sandbox. The caller sets the machine up for each case (ci:
# kernel.apparmor_restrict_unprivileged_userns=0 or 1). Must not run as root:
# Chromium never sandboxes root, so the sandboxed case could not pass.

set -euo pipefail

appimage="$(readlink -f "${1:?usage: $0 <AppImage> sandboxed|fallback}")"
expect="${2:?usage: $0 <AppImage> sandboxed|fallback}"
here="$(cd "$(dirname "$0")" && pwd)"
exec_name="fleet-runner"

fail() { echo "FAIL: $*" >&2; exit 1; }
[ "$(id -u)" != 0 ] || fail "run as a normal user; Chromium never sandboxes root"
case "$expect" in sandboxed|fallback) ;; *) fail "expect must be sandboxed or fallback" ;; esac

work="$(mktemp -d)"
cleanup() {
  pkill -u "$(id -u)" -f "${exec_name}-bin" 2>/dev/null || true
  sleep 1
  pkill -9 -u "$(id -u)" -f "${exec_name}-bin" 2>/dev/null || true
  rm -rf "$work" /tmp/appimage_extracted_* 2>/dev/null || true
}
trap cleanup EXIT

# ── 1. What was packaged ─────────────────────────────────────────────────────
( cd "$work" && "$appimage" --appimage-extract >/dev/null )
root="$work/squashfs-root"
[ -x "$root/${exec_name}-bin" ] || fail "${exec_name}-bin missing: afterPack did not run"
diff <(sed "s/@EXEC@/${exec_name}/g" "$here/linux-launcher.sh") "$root/${exec_name}" \
  || fail "packaged ${exec_name} is not desktop/scripts/linux-launcher.sh"
if grep -h '^Exec=' "$root"/*.desktop | grep -q -- '--no-sandbox'; then
  fail ".desktop Exec= passes --no-sandbox"
fi
echo "ok    packaged launcher matches linux-launcher.sh; .desktop has no --no-sandbox"
rm -rf "$root"

# ── 2. What actually runs ────────────────────────────────────────────────────
mkdir -p "$work/home"
log="$work/app.log"
echo "      userns restriction: $(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo n/a)"
HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" APPIMAGE_EXTRACT_AND_RUN=1 \
  xvfb-run -a "$appimage" --disable-gpu >"$log" 2>&1 &

# Chromium replaces its first renderer early in startup, so a pid can vanish
# between being listed and being read: read every live one, tolerate the rest,
# and only judge once the app has been up for a while.
cmdline() { tr '\0' ' ' <"/proc/$1/cmdline" 2>/dev/null; }
main="" renderers="" up=0
for _ in $(seq 1 90); do
  main="" renderers=""
  for pid in $(pgrep -u "$(id -u)" -f -- "${exec_name}-bin" || true); do
    cmd="$(cmdline "$pid")" || continue
    case "$cmd" in
      *--type=renderer*) renderers="$renderers $pid" ;;
      *--type=*) ;;
      ?*) main="$pid" ;;
    esac
  done
  if [ -n "$main" ] && [ -n "$renderers" ]; then
    up=$((up + 1))
    [ "$up" -ge 10 ] && break
  fi
  sleep 1
done
if [ -z "$main" ] || [ -z "$renderers" ]; then
  tail -40 "$log" >&2
  fail "no main + renderer process stayed up: the packaged app did not start"
fi

main_cmd="$(cmdline "$main")"
echo "      main $main: $main_cmd"
our_userns="$(readlink /proc/self/ns/user)"
checked=0 unsandboxed=0
for pid in $renderers; do
  seccomp="$(awk '/^Seccomp:/ {print $2}' "/proc/$pid/status" 2>/dev/null)" || continue
  userns="$(readlink "/proc/$pid/ns/user" 2>/dev/null)" || continue
  [ -n "$seccomp" ] || continue
  checked=$((checked + 1))
  shares=no
  [ "$userns" = "$our_userns" ] && shares=yes
  echo "      renderer $pid: Seccomp=$seccomp, shares our user namespace=$shares"
  if [ "$seccomp" != 2 ] || [ "$shares" = yes ]; then unsandboxed=$((unsandboxed + 1)); fi
done
[ "$checked" -gt 0 ] || fail "renderers exited before they could be inspected"

if [ "$expect" = sandboxed ]; then
  case "$main_cmd" in *--no-sandbox*) fail "main process was started with --no-sandbox" ;; esac
  [ "$unsandboxed" = 0 ] || fail "$unsandboxed renderer(s) run outside the namespace + seccomp-bpf sandbox"
  if grep -q 'starting WITHOUT the Chromium sandbox' "$log"; then fail "launcher printed the fallback notice"; fi
  echo "ok    packaged AppImage runs SANDBOXED, without --no-sandbox"
else
  case "$main_cmd" in *--no-sandbox*) ;; *) fail "fallback expected, but main has no --no-sandbox" ;; esac
  grep -q 'Fleet Runner: starting WITHOUT the Chromium sandbox, because' "$log" \
    || fail "fell back without the stderr notice"
  echo "ok    packaged AppImage starts on a userns-restricted host, with the fallback notice:"
  grep -A1 'starting WITHOUT the Chromium sandbox' "$log" | sed 's/^/      /'
fi
