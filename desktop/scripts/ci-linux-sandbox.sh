#!/usr/bin/env bash
#
# CI driver for test-linux-sandbox.sh: proves a packaged AppImage on both
# kinds of Linux host by flipping Ubuntu's AppArmor userns restriction.
#
#   desktop/scripts/ci-linux-sandbox.sh <Fleet-Runner-*.AppImage>
#
#   restriction 0  user namespaces allowed  -> must run SANDBOXED
#   restriction 1  user namespaces blocked  -> must still start, with the
#                                              fallback notice (the case that
#                                              used to FATAL without the flag)
#
# Needs passwordless sudo (GitHub's Ubuntu runners have it) and Ubuntu 24.04+,
# where kernel.apparmor_restrict_unprivileged_userns exists. The original
# value is restored on exit.

set -euo pipefail

appimage="${1:?usage: $0 <AppImage>}"
here="$(cd "$(dirname "$0")" && pwd)"
knob=/proc/sys/kernel/apparmor_restrict_unprivileged_userns

if [ ! -e "$knob" ]; then
  echo "::error::$knob is missing on this runner, so the userns-blocked case cannot be set up." >&2
  echo "This test needs Ubuntu 24.04 or later." >&2
  exit 1
fi
command -v xvfb-run >/dev/null 2>&1 || { sudo apt-get update -q && sudo apt-get install -y -q xvfb; }

original="$(cat "$knob")"
trap 'sudo sysctl -q -w kernel.apparmor_restrict_unprivileged_userns="$original"' EXIT
echo "runner default: kernel.apparmor_restrict_unprivileged_userns=$original"

echo "== user namespaces allowed"
sudo sysctl -q -w kernel.apparmor_restrict_unprivileged_userns=0
"$here/test-linux-sandbox.sh" "$appimage" sandboxed

echo "== user namespaces blocked"
sudo sysctl -q -w kernel.apparmor_restrict_unprivileged_userns=1
"$here/test-linux-sandbox.sh" "$appimage" fallback
