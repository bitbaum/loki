#!/usr/bin/env bash
# Shared helpers for the Hetzner self-host tooling. Source, don't execute.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
BOX="$BOX_UBUNTU"
# Overridable so a caller can judge a PRISTINE register instead of the working
# tree. On the workstation ~15 agent sessions share these checkouts, so the
# tree is a scratchpad: on 2026-08-28 the daily register check read apps.conf
# mid-edit (substrata listed twice) and paged about a duplicate port that had
# never been committed. CI still judges the working tree, which is correct
# there — in CI the working tree IS the commit under review.
MANIFEST="${MANIFEST:-$HERE/apps.conf}"

# default_branch [repo_dir] — the remote's default branch name, resolved not guessed.
#
# 28 repos here use `main`, 3 use `master` (aoz-begleitung, dotfiles,
# sbb-lost-found), and 2 have no origin/HEAD set at all. Anything that hardcodes
# "origin/main" silently does the wrong thing on a fifth of the fleet — a gate
# that cannot find its base branch either blocks everything or checks nothing.
#
# Order: the remote's own answer, then whichever of main/master exists, then
# fail. Never a hardcoded guess.
default_branch() {
  local repo="${1:-.}" b
  b=$(git -C "$repo" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null) && { echo "${b#origin/}"; return 0; }
  for b in main master; do
    git -C "$repo" rev-parse --verify --quiet "refs/remotes/origin/$b" >/dev/null 2>&1 && { echo "$b"; return 0; }
  done
  # origin/HEAD unset and neither name present. Fix with:
  #   git remote set-head origin -a
  return 1
}


# app_lookup <name> — sets NAME PORT DOMAINS REPO APP_DIR DB or exits 1
app_lookup() {
  local line
  line=$(grep -v '^#' "$MANIFEST" | grep "^$1|" || true)
  [ -z "$line" ] && { echo "ERROR: '$1' not in $MANIFEST" >&2; return 1; }
  # Extra fields must be named, or bash's last variable swallows the remainder
  # and DB silently becomes "db|owner|kind|...". Missing trailing fields read as
  # empty, so a 6-field line still parses exactly as before.
  IFS='|' read -r NAME PORT DOMAINS REPO APP_DIR DB OWNER KIND STATUS PLAN PRICE SINCE <<<"$line"
}

app_names() { grep -v '^#' "$MANIFEST" | cut -d'|' -f1; }

# next_free_port <candidate> <newline-separated taken ports> — the first port at
# or above <candidate> that nothing holds.
#
# The register is NOT the only thing listening on this box, and it never claimed
# to be: the four handcrafted services on 4001-4004 are excluded by design, and
# annushka's enquiry API sits on 4030 behind a hand-written vhost precisely so
# sync-infra will not touch it. Allocating from `max(registered)+1` alone was
# therefore walking toward 4030 — four sites away as of 2026-09-10, and three
# rows were added that day. A port collision does not fail loudly at allocation;
# it fails when the new unit starts, binds nothing, and the OTHER app is the one
# that looks broken.
#
# Pure so it can be tested without the box: the caller supplies what is taken.
next_free_port() {
  local p="$1" taken="${2:-}"
  while grep -qx "$p" <<<"$taken"; do
    p=$((p + 1))
  done
  printf '%s' "$p"
}

# listening_ports — every TCP port with a listener on the box, one per line.
# Empty output means "could not ask", which the caller MUST announce rather than
# treat as "nothing is listening"; those two look identical and only one is safe.
listening_ports() {
  box "ss -ltnH 2>/dev/null | awk '{print \$4}'" 2>/dev/null \
    | sed 's/.*://' | grep -E '^[0-9]+$' | sort -un
}

# -n: don't consume stdin (box() is used inside while-read loops)
# -i: the deploy key when it is readable. On the box itself these scripts run
# as ubuntu from inside loki-app (register-cd), and ubuntu's only private
# key is the CI deploy key — whose public half is what authorizes CI. Without
# naming it, ssh offers nothing and the box refuses itself ("Permission denied
# (publickey)"), which is how sync-infra failed on velokiosk-sep10.
box() {
  if [ -r "${DEPLOY_KEY_PATH:-}" ]; then
    ssh -n -o BatchMode=yes -i "$DEPLOY_KEY_PATH" "$BOX" "$@"
  else
    ssh -n -o BatchMode=yes "$BOX" "$@"
  fi
}
