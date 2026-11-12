#!/usr/bin/env bash
# Check, and on request repair, GRUB's environment block on the bitbaum box.
# Piped to `bash -s` as root from .github/workflows/grubenv-repair.yml (same
# SSH setup as disk-cleanup.yml).
#
# Usage: grubenv-repair.sh [1|0]
#   1 = dry run (default): read-only check and the plan, changes nothing
#   0 = repair, only if the block is invalid
#
# Why: grub-initrd-fallback.service fails with "invalid environment block"
# when /boot/grub/grubenv is no longer a valid 1024-byte block that starts
# with "# GRUB Environment Block" (an unclean shutdown, or a write while the
# disk was full). The block holds only GRUB's small boot flags (recordfail,
# initrdfail, saved_entry).
#
# Repair is reversible: the old file is copied to /root before anything is
# replaced, the new block is created next to it and validated, and only then
# moved into place. The only thing lost is a remembered boot entry, so when
# GRUB_DEFAULT=saved the default is set back to entry 0.
#
# Output is statuses and sizes only. This repo is public, and so are its run logs.
set -uo pipefail

DRY="${1:-1}"
F=/boot/grub/grubenv
UNIT=grub-initrd-fallback.service
HEADER="# GRUB Environment Block"

state() {
  echo "-- $1"
  if [ -e "$F" ]; then
    echo "file: present, $(stat -c %s "$F") bytes"
    if [ "$(head -c ${#HEADER} "$F" 2>/dev/null)" = "$HEADER" ]; then echo "header: ok"; else echo "header: MISSING"; fi
    if grub-editenv "$F" list >/dev/null 2>&1; then echo "grub-editenv list: ok"; else echo "grub-editenv list: FAILS"; fi
  else
    echo "file: absent"
  fi
  echo "unit $UNIT: $(systemctl is-active "$UNIT" 2>/dev/null) / failed=$(systemctl is-failed "$UNIT" 2>/dev/null)"
  df -h /boot | tail -1 | awk '{print "/boot: " $5 " used of " $2}'
}

valid() {
  [ -e "$F" ] && [ "$(stat -c %s "$F")" = 1024 ] \
    && [ "$(head -c ${#HEADER} "$F")" = "$HEADER" ] \
    && grub-editenv "$F" list >/dev/null 2>&1
}

command -v grub-editenv >/dev/null || { echo "::error::grub-editenv is not installed"; exit 1; }
GRUB_DEFAULT_LINE="$(grep -E '^GRUB_DEFAULT=' /etc/default/grub 2>/dev/null || echo 'GRUB_DEFAULT=(unset)')"
echo "dry_run=$DRY  $GRUB_DEFAULT_LINE"
state "before"

if valid; then
  echo "verdict: grubenv is valid, nothing to repair"
  if [ "$DRY" = 0 ] && systemctl is-failed --quiet "$UNIT"; then
    systemctl reset-failed "$UNIT"; systemctl start "$UNIT"
    state "after (unit restarted only)"
  fi
  exit 0
fi

echo "verdict: grubenv is INVALID"
BACKUP="/root/grubenv.corrupt.$(date -u +%Y%m%dT%H%M%SZ)"
echo "plan: copy $F to $BACKUP, create a fresh block, validate it, move it into place"
case "$GRUB_DEFAULT_LINE" in GRUB_DEFAULT=saved*) echo "plan: grub-set-default 0 (GRUB_DEFAULT=saved)";; esac
echo "plan: systemctl reset-failed + start $UNIT"
if [ "$DRY" != 0 ]; then echo "dry run: nothing changed"; exit 0; fi

set -e
[ -e "$F" ] && cp -a "$F" "$BACKUP" && echo "backup: $BACKUP ($(stat -c %s "$BACKUP") bytes)"
rm -f "$F.new"
grub-editenv "$F.new" create
grub-editenv "$F.new" list >/dev/null
mv -f "$F.new" "$F"
case "$GRUB_DEFAULT_LINE" in GRUB_DEFAULT=saved*) grub-set-default 0;; esac
set +e
systemctl reset-failed "$UNIT" 2>/dev/null
systemctl start "$UNIT"
state "after"
valid && echo "result: grubenv valid" || { echo "::error::grubenv still invalid; restore with: cp -a $BACKUP $F"; exit 1; }
