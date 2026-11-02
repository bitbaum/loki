#!/usr/bin/env bash
# install-fleet-runner.sh — install Fleet Runner on Linux as a self-updating
# systemd user service.
#
#   ./scripts/install-fleet-runner.sh            # install/upgrade + wire the units
#   ./scripts/install-fleet-runner.sh --update   # check + apply (what the timer runs)
#   ./scripts/install-fleet-runner.sh --status   # what is installed vs. published
#
# ── Why this file exists ──────────────────────────────────────────────────────
#
# Fleet Runner ships an in-app updater (electron-updater, see
# desktop/src/main/index.ts). On a real box it silently could not finish the
# job, and the failure looked exactly like a working updater: the app checked,
# found 0.8.12, downloaded it, and posted "Fleet Runner v0.8.12 ready" — while
# staying on 0.8.11 for twelve days. Four independent reasons, each fatal:
#
#   1. The install was an EXTRACTED DIRECTORY (~/Applications/FleetRunner-0.8.11/).
#      electron-updater's detectInstallFormat() returns 'unknown' for that, and
#      on Linux it can only self-apply an AppImage. So it picked the .deb...
#   2. ...which needs `sudo dpkg -i`. Electron cannot escalate from userspace,
#      so the download parked in ~/.cache/fleet-runner-updater/pending/ forever.
#   3. The systemd unit hardcoded the VERSION IN THE PATH
#      (ExecStart=.../FleetRunner-0.8.11/fleet-runner). Even a perfect
#      self-update would have been overridden on the next boot — systemd would
#      have kept launching 0.8.11 out of the old directory.
#   4. The box cannot run an AppImage at all: AppImage type-2 needs libfuse2
#      (`libfuse.so.2`) and this machine has only libfuse3. So "just install the
#      AppImage and let electron-updater do its thing" is not available either —
#      the unit crash-loops with "AppImages require FUSE to run".
#
# Hence: download the AppImage, verify it, and EXTRACT it. Extraction needs no
# FUSE, so this works on every Linux box regardless of libfuse generation, and
# it produces exactly the layout the runner already ran from. The extracted
# tree goes in a versioned directory and a STABLE SYMLINK points at the current
# one, so the unit never names a version and an upgrade is one atomic rename.
#
# A systemd timer applies updates. It does not depend on the app being healthy,
# on a quit hook winning a race against SIGTERM, or on sudo — and every run
# lands in journald, so "did it update?" is a question with an answer.
#
# Deliberately no sudo anywhere: everything lives under $HOME and
# ~/.config/systemd/user. A background updater that needs a password is an
# updater that never runs.

set -euo pipefail

RELEASES_REPO="${FLEET_RUNNER_RELEASES_REPO:-bitbaum/loki-releases}"
APP_DIR="$HOME/Applications"
CURRENT_LINK="$APP_DIR/FleetRunner"                # stable — never versioned
UNIT_DIR="$HOME/.config/systemd/user"
BIN_DIR="$HOME/.local/bin"
# The timer must keep working after the repo checkout it was installed from is
# gone (a worktree, a moved clone). write_units copies this script here and
# points the unit at the copy.
INSTALLED_SELF="$BIN_DIR/fleet-runner-update"
SERVICE="fleet-runner.service"
UPDATE_SERVICE="fleet-runner-update.service"
UPDATE_TIMER="fleet-runner-update.timer"
ASSET="Fleet-Runner-linux-x86_64.AppImage"
# Versions to keep on disk besides the running one — one is enough to roll back
# by hand (`ln -sfnT fleet-runner-<old> ~/Applications/FleetRunner`).
KEEP_OLD=1

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# Partial downloads and half-extracted trees must never survive, whether we
# return, exit, or die.
WORK_DIR=""
cleanup() { [ -n "$WORK_DIR" ] && rm -rf "$WORK_DIR"; return 0; }
trap cleanup EXIT

log() { echo "[fleet-runner] $*"; }
die() { echo "[fleet-runner] ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"; }

# ── Release lookup ────────────────────────────────────────────────────────────
# The releases repo is public, so this works with no token — which matters: the
# timer runs unattended and must not depend on a `gh auth` session.

latest_tag() {
  curl -fsSL "https://api.github.com/repos/${RELEASES_REPO}/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1
}

# latest-linux.yml is the same manifest electron-updater reads, so the timer
# and the in-app updater can never disagree about what "latest" means.
manifest() {
  curl -fsSL "https://github.com/${RELEASES_REPO}/releases/download/$1/latest-linux.yml"
}

# The symlink IS the record of what is installed — not a version file that can
# drift from the tree it claims to describe.
installed_version() {
  local target
  target="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
  echo "${target#fleet-runner-}" | grep . || echo "none"
}

# Read the sha512 belonging to our asset out of the files: list. Deliberately
# NOT the top-level `sha512:` — that one is keyed to `path:`, and a future
# manifest reordering could hand us the .deb's digest without anything looking
# wrong. index() rather than a regex: the asset name contains '.' and '-'.
asset_sha512() {
  awk -v a="$ASSET" '
    index($0, "url: " a) { found = 1; next }
    found && index($0, "sha512:") { sub(/^ *sha512: */, ""); print; exit }
  '
}

# ── Download → verify → extract → swap ────────────────────────────────────────

# Install the published build for tag $1 and point the stable symlink at it.
# Nothing touches the symlink until the download is checksum-verified AND the
# extracted tree is confirmed to contain a runnable binary.
fetch_and_install() {
  local tag="$1" yml version expected_sha actual image dest previous

  yml="$(manifest "$tag")" || die "cannot read latest-linux.yml for $tag"
  version="$(echo "$yml" | sed -n 's/^version: *//p' | head -1)"
  expected_sha="$(echo "$yml" | asset_sha512)"
  [ -n "$version" ] || die "manifest has no version"
  [ -n "$expected_sha" ] || die "manifest has no sha512 for $ASSET"

  mkdir -p "$APP_DIR"
  WORK_DIR="$(mktemp -d "$APP_DIR/.fleet-runner-work.XXXXXX")"
  image="$WORK_DIR/$ASSET"

  log "downloading $ASSET ($version)…"
  curl -fsSL -o "$image" \
    "https://github.com/${RELEASES_REPO}/releases/download/${tag}/${ASSET}" \
    || die "download failed"

  actual="$(openssl dgst -sha512 -binary "$image" | openssl base64 -A)"
  [ "$actual" = "$expected_sha" ] || die "checksum mismatch — refusing to install
  expected: $expected_sha
  actual:   $actual"
  log "checksum verified"

  # --appimage-extract needs no FUSE (see reason 4 above) and always writes
  # ./squashfs-root relative to CWD, so it must run inside the work dir.
  chmod +x "$image"
  log "extracting…"
  ( cd "$WORK_DIR" && ./"$ASSET" --appimage-extract >/dev/null ) \
    || die "extraction failed"
  [ -x "$WORK_DIR/squashfs-root/fleet-runner" ] \
    || die "extracted tree has no runnable fleet-runner binary — refusing to install"

  dest="$APP_DIR/fleet-runner-$version"
  rm -rf "$dest"
  mv "$WORK_DIR/squashfs-root" "$dest"

  previous="$(installed_version)"
  # A real directory here would make `mv -T` move the link INTO it rather than
  # replace it, quietly producing FleetRunner/FleetRunner. Fail loudly instead.
  if [ -d "$CURRENT_LINK" ] && [ ! -L "$CURRENT_LINK" ]; then
    die "$CURRENT_LINK is a real directory, not a symlink — move it aside first"
  fi
  # Atomic swap: create the new link beside the old one, then rename over it.
  # `ln -sfn` alone is not atomic — there is a window with no symlink at all,
  # and systemd starting in that window would fail to exec.
  ln -sfnT "fleet-runner-$version" "$CURRENT_LINK.new"
  mv -Tf "$CURRENT_LINK.new" "$CURRENT_LINK"
  log "installed $version → $CURRENT_LINK -> fleet-runner-$version"

  prune_old "$version" "$previous"
}

# Keep the running version plus $KEEP_OLD older trees (each ~500MB). Rollback
# stays possible without keeping every build ever downloaded.
prune_old() {
  local keep_current="$1" keep_previous="$2" d name
  for d in "$APP_DIR"/fleet-runner-*/; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    if [ "$name" = "fleet-runner-$keep_current" ]; then continue; fi
    if [ "$KEEP_OLD" -gt 0 ] && [ "$name" = "fleet-runner-$keep_previous" ]; then continue; fi
    log "pruning old build $name"
    rm -rf "$d"
  done
}

# ── systemd units ─────────────────────────────────────────────────────────────

write_units() {
  mkdir -p "$UNIT_DIR" "$BIN_DIR"

  if [ "$SELF" != "$INSTALLED_SELF" ]; then
    install -m 0755 "$SELF" "$INSTALLED_SELF"
    log "updater copied to $INSTALLED_SELF"
  fi

  # The GPU flags are not cosmetic: this box's GPU process aborts (SIGABRT)
  # under Wayland, so software rendering is what keeps the runner alive.
  # No --no-sandbox: the app's own launcher (desktop/scripts/linux-launcher.sh)
  # keeps the Chromium sandbox on where the kernel allows it and falls back,
  # with a message in the journal, where it does not.
  cat > "$UNIT_DIR/$SERVICE" <<EOF
[Unit]
Description=Fleet Runner (Loki local executor) — supervised
After=graphical-session.target
PartOf=graphical-session.target
StartLimitIntervalSec=0

[Service]
Type=simple
# STABLE path — a symlink, never a versioned directory. The updater flips the
# symlink, so this line survives every upgrade untouched. Baking a version in
# here is what pinned this box to 0.8.11 while the app kept announcing 0.8.12.
ExecStart=${CURRENT_LINK}/fleet-runner --disable-gpu --disable-gpu-compositing
Environment=WAYLAND_DISPLAY=wayland-0
Environment=DISPLAY=:0
Environment=ELECTRON_OZONE_PLATFORM_HINT=auto
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=graphical-session.target
EOF

  cat > "$UNIT_DIR/$UPDATE_SERVICE" <<EOF
[Unit]
Description=Fleet Runner — check for and apply updates
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${INSTALLED_SELF} --update
StandardOutput=journal
StandardError=journal
EOF

  # Persistent=true is the point of the whole timer: a laptop asleep at the
  # scheduled hour runs the check on the next wake instead of skipping the day.
  # OnStartupSec covers the machine that was off for a week — it is current
  # before the first agent is dispatched, not a day later.
  cat > "$UNIT_DIR/$UPDATE_TIMER" <<EOF
[Unit]
Description=Fleet Runner — daily update check

[Timer]
OnCalendar=daily
OnStartupSec=10m
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl --user daemon-reload
  log "units written to $UNIT_DIR"
}

# ── Modes ─────────────────────────────────────────────────────────────────────

# `systemctl is-active` prints its answer AND exits non-zero when the unit is
# not running, so `$(... || echo inactive)` yields TWO lines. Take the printed
# answer and only fall back when it is empty (unit file absent entirely).
unit_state() {
  local state
  state="$(systemctl --user is-active "$1" 2>/dev/null || true)"
  echo "${state:-unknown}"
}

do_status() {
  local tag published
  tag="$(latest_tag)" || true
  published="${tag#fleet-runner-v}"
  echo "installed:  $(installed_version)"
  echo "published:  ${published:-<unreachable>}  (${RELEASES_REPO})"
  echo "binary:     $CURRENT_LINK/fleet-runner -> $(readlink "$CURRENT_LINK" 2>/dev/null || echo '<no symlink>')"
  echo "service:    $(unit_state "$SERVICE")"
  echo "timer:      $(unit_state "$UPDATE_TIMER")"
}

do_update() {
  local tag published current
  tag="$(latest_tag)"
  [ -n "$tag" ] || die "could not resolve the latest release from $RELEASES_REPO"
  published="${tag#fleet-runner-v}"
  current="$(installed_version)"

  if [ "$published" = "$current" ] && [ -x "$CURRENT_LINK/fleet-runner" ]; then
    log "already current ($current) — nothing to do"
    return 0
  fi

  log "update: $current → $published"
  fetch_and_install "$tag"
  # Restart only after a verified swap. A failed download or extraction exits
  # non-zero above and leaves the running version untouched.
  if systemctl --user is-active --quiet "$SERVICE"; then
    systemctl --user restart "$SERVICE"
    log "restarted $SERVICE on $published"
  else
    log "$SERVICE not running — new version will be used on next start"
  fi
}

do_install() {
  local tag
  tag="$(latest_tag)"
  [ -n "$tag" ] || die "could not resolve the latest release from $RELEASES_REPO"
  fetch_and_install "$tag"
  write_units
  systemctl --user enable --now "$UPDATE_TIMER" >/dev/null 2>&1 || \
    die "could not enable $UPDATE_TIMER"
  systemctl --user enable "$SERVICE" >/dev/null 2>&1 || true
  systemctl --user restart "$SERVICE"
  log "Fleet Runner $(installed_version) running; daily update check armed"
  do_status
}

need curl
need openssl
need systemctl

case "${1:-}" in
  --update) do_update ;;
  --status) do_status ;;
  ""|--install) do_install ;;
  *) die "unknown option: $1 (use --install, --update or --status)" ;;
esac
