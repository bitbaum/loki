#!/bin/bash
# Fleet Runner Linux launcher. desktop/scripts/afterPack.cjs installs this
# under the executable's name and moves the real Electron binary to
# "@EXEC@-bin"; "@EXEC@" is replaced at pack time.
#
# It starts Electron WITH the Chromium sandbox whenever the machine can give
# it one, and says so out loud when it cannot.
#
# Chromium sandboxes its renderers one of two ways:
#   1. unprivileged user namespaces (needs no setuid helper), tried first;
#   2. the setuid `chrome-sandbox` helper, owned by root with mode 4755.
# Inside an AppImage (2) can never work: the FUSE mount is nosuid. So an
# AppImage is sandboxed exactly when (1) is available. Where it is not
# (Ubuntu 24.04+ with kernel.apparmor_restrict_unprivileged_userns=1, Debian
# with kernel.unprivileged_userns_clone=0, user.max_user_namespaces=0) and (2)
# is not either, Chromium aborts at FATAL before any app code runs. Only then
# does this launcher add --no-sandbox, with a message saying why and how to
# fix it, and FLEET_RUNNER_SANDBOX_OFF set so the app can show it too.
#
# FLEET_RUNNER_SANDBOX=on   skip the probe and always sandbox (e.g. an
#                           AppArmor profile grants userns to this binary only)
# FLEET_RUNNER_SANDBOX=off  never sandbox (stated, not silent)

HERE_DIR="$(dirname "$(readlink -f "$0")")"
REAL_BIN="$HERE_DIR/@EXEC@-bin"

# The same test Chromium makes (sandbox/linux/services/credentials.cc
# CanCreateProcessInNewUserNS): create a user namespace, write its uid/gid
# maps, then create another one inside it.
userns_available() {
  if command -v unshare >/dev/null 2>&1; then
    unshare --user --map-root-user unshare --user true >/dev/null 2>&1
    return
  fi
  # No unshare(1): read the switches that are known to turn it off.
  [ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 1)" != 0 ] &&
    [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1)" != 0 ] &&
    [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" != 1 ]
}

# A .deb install: dpkg's postinst makes chrome-sandbox setuid root.
setuid_helper_usable() {
  [ -z "${APPIMAGE:-}" ] || return 1 # AppImage FUSE mounts are nosuid
  local helper="$HERE_DIR/chrome-sandbox"
  [ -u "$helper" ] && [ "$(stat -c %u "$helper" 2>/dev/null)" = 0 ]
}

reason=""
case "${FLEET_RUNNER_SANDBOX:-auto}" in
  on) ;;
  off) reason="FLEET_RUNNER_SANDBOX=off is set" ;;
  *)
    if [ "$(id -u)" = 0 ]; then
      reason="it is running as root, and Chromium will not sandbox a root process"
    elif userns_available || setuid_helper_usable; then
      :
    else
      reason="this system blocks unprivileged user namespaces and chrome-sandbox is not setuid root"
    fi
    ;;
esac

# electron-builder's AppRun runs first and makes its own `unshare -Ur true`
# probe; where that fails it appends --no-sandbox silently. A person can pass
# it too. Either way it is honoured, and said.
passed_no_sandbox=no
for arg in "$@"; do
  if [ "$arg" = --no-sandbox ]; then passed_no_sandbox=yes; fi
done
if [ -z "$reason" ] && [ "$passed_no_sandbox" = yes ]; then
  reason="--no-sandbox was passed on its command line"
fi

if [ -z "$reason" ]; then
  exec "$REAL_BIN" "$@"
fi

cat >&2 <<EOF
Fleet Runner: starting WITHOUT the Chromium sandbox, because $reason.
  Pages it opens then run with no OS-level isolation. To turn the sandbox back on:
  - allow unprivileged user namespaces (Ubuntu 24.04+: an AppArmor profile
    granting 'userns' to this binary, or
    sysctl kernel.apparmor_restrict_unprivileged_userns=0), or
  - install the .deb package, whose chrome-sandbox helper is setuid root.
EOF
export FLEET_RUNNER_SANDBOX_OFF="$reason"
if [ "$passed_no_sandbox" = yes ]; then
  exec "$REAL_BIN" "$@"
fi
exec "$REAL_BIN" --no-sandbox "$@"
