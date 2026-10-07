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

# ------------------------------------------------------------ custom domains
#
# A site starts on <slug>.$SITES_BASE_DOMAIN and may later be given its own
# domain (evig.orangecat.ch -> evig.ch). Both live in the row's `domains`
# field — the one register — and this is the one rule for what that means:
#
#   * no host outside the base domain  -> every host is served (unchanged)
#   * one or more hosts outside it     -> the FIRST of them is canonical; the
#     other own-domain hosts (www.) are served too, and every base-domain host
#     answers with a 308 to the canonical one
#
# 308, never 301: a 301 lets the client turn a POST into a bodyless GET, which
# is how evig's credentials callback broke behind the revampit host
# (2026-08-16). The base-domain host keeps working as an address, so links
# printed before the move still land — on the site's own name.
#
# Every row in the register today is in the first case or is own-domain only
# (sink), so this rule changes no existing vhost; test-custom-domain.sh pins
# that against the real register.

# is_base_host <host> <base> — true for the base domain and anything under it.
is_base_host() { [ "$1" = "$2" ] || [[ "$1" == *".$2" ]]; }

# canonical_host <domains> <base> — the address a row is MEANT to be reached
# at: its first own-domain host, else its first host.
canonical_host() {
  local h first="" hosts
  IFS=',' read -ra hosts <<<"$1"
  for h in "${hosts[@]}"; do
    [ -n "$h" ] || continue
    [ -n "$first" ] || first="$h"
    is_base_host "$h" "$2" || { printf '%s' "$h"; return 0; }
  done
  printf '%s' "$first"
}

# caddy_vhost <name> <port> <domains> <base> — the apps.d file for one row.
# Pure (prints, touches nothing) so the redirect rule above is testable
# without a box. sync-infra.sh is its only writer.
caddy_vhost() {
  local name="$1" port="$2" domains="$3" base="$4" h canonical serve="" redirect="" hosts
  canonical=$(canonical_host "$domains" "$base")
  IFS=',' read -ra hosts <<<"$domains"
  for h in "${hosts[@]}"; do
    [ -n "$h" ] || continue
    if [ "$canonical" != "$h" ] && ! is_base_host "$canonical" "$base" && is_base_host "$h" "$base"; then
      redirect="${redirect:+$redirect, }$h"
    else
      serve="${serve:+$serve, }$h"
    fi
  done
  cat <<VHOST
$serve {
  import access_log
  encode zstd gzip
  handle_path /uploads/* {
    root * /opt/$name/uploads
    file_server
  }
  reverse_proxy 127.0.0.1:$port {
    flush_interval -1
    # Re-dial across a restart instead of returning 502 the moment the upstream
    # refuses. A deploy takes the port down for a few seconds; without this that
    # window is served to users as errors. Only the dial is retried, so a request
    # that already reached the app is never replayed.
    lb_try_duration 20s
    lb_try_interval 250ms
  }
}
VHOST
  [ -z "$redirect" ] || cat <<VHOST

# The site's own domain is canonical; its free address stays reachable and
# forwards there with the method and body intact (308).
$redirect {
  import access_log
  redir https://$canonical{uri} 308
}
VHOST
}

# publish_register_row <slug> <line> — make origin/main's register hold <line>
# as the row for <slug> (append when absent, replace when different), through
# a branch and a PR, the way every other change reaches main. Best-effort and
# announced: the durable register on the box already has the change either way.
publish_register_row() {
  local slug="$1" line="$2" fc_git wt branch title repo
  fc_git="$(dirname "$(dirname "$(dirname "$MANIFEST")")")"
  git -C "$fc_git" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || { printf '  register row not published: %s is not a git checkout\n' "$fc_git"; return 0; }
  branch="register/$slug"
  wt="$(mktemp -d)/fc"
  if git -C "$fc_git" fetch -q origin main 2>/dev/null \
     && git -C "$fc_git" worktree add -q -B "$branch" "$wt" origin/main 2>/dev/null; then
    local current
    current=$(grep "^$slug|" "$wt/scripts/hetzner/apps.conf" || true)
    if [ "$current" = "$line" ]; then
      printf '  register row already on main\n'
    else
      if [ -z "$current" ]; then
        printf '%s\n' "$line" >> "$wt/scripts/hetzner/apps.conf"
        title="chore(register): add $slug"
      else
        awk -v s="$slug|" -v l="$line" 'index($0, s) == 1 { print l; next } { print }' \
          "$wt/scripts/hetzner/apps.conf" > "$wt/apps.conf.new" \
          && mv "$wt/apps.conf.new" "$wt/scripts/hetzner/apps.conf"
        title="chore(register): update $slug"
      fi
      repo=$(git -C "$fc_git" remote get-url origin | sed -E 's#^https://([^@/]+@)?github.com/##; s#^git@github.com:##; s#\.git$##')
      local pr
      if git -C "$wt" -c user.name="$GIT_SCAFFOLD_NAME" -c user.email="$GIT_SCAFFOLD_EMAIL" \
           commit -q -am "$title" \
         && env -u GH_TOKEN -u GITHUB_TOKEN git -C "$wt" push -q -f -u origin "$branch" 2>/dev/null \
         && pr=$(env -u GH_TOKEN -u GITHUB_TOKEN gh pr create --repo "$repo" \
                 --head "$branch" --base main --title "$title" \
                 --body "Written on the box by the register scripts. Row: \`$line\`" 2>/dev/null); then
        printf '  register row sent to main: %s\n' "$pr"
      else
        printf '  ⚠ register row not published to main (push or PR failed) — the durable register still has it\n'
      fi
    fi
    git -C "$fc_git" worktree remove -f "$wt" >/dev/null 2>&1 || true
  else
    printf '  ⚠ register row not published to main (could not fetch or branch)\n'
  fi
  rm -rf "$(dirname "$wt")"
  return 0
}

# ------------------------------------------------------------ sleep when idle
#
# A site that is a demo, a prospect or not yet verified does not need a process
# running all day. For those, systemd itself listens on the site's port (a
# .socket unit); the first request starts <name>-wake.service, a
# systemd-socket-proxyd that requires the app, so the app boots, and the proxy
# forwards to it on an inner port. After $SLEEP_IDLE_TIME with no connection the
# proxy exits, and the app — BindsTo the proxy — stops with it. The socket keeps
# listening, so the next visitor wakes it again (a second or two).
#
# Nothing outside the box changes: Caddy and deploy.sh keep talking to
# 127.0.0.1:$PORT. A `systemctl restart <name>-app` (every deploy) also pulls
# the proxy up through BindsTo, so the deploy's health probe works unchanged.
#
# Handcrafted services (4001-4004) and internal-only rows never sleep.

# sleeps_when_idle <port> <domains> <status>
sleeps_when_idle() {
  local s
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -gt 4004 ] || return 1
  [ -n "$2" ] && [ "$2" != "-" ] || return 1
  for s in $SLEEP_WHEN_IDLE_STATUSES; do [ "$3" = "$s" ] && return 0; done
  return 1
}

# wake_inner_port <port> — where a sleeping app itself listens. 20000 above its
# public port: the app range is 4005-4999, so 24005-24999 holds nothing else.
wake_inner_port() { printf '%s' "$(($1 + 20000))"; }

# sleep_app_unit <app-unit-text> <name> <inner-port> — the app unit for a
# sleeping site: bound to its wake proxy, ready only once it accepts
# connections (so the proxy, ordered after it, never dials a closed port), and
# with no [Install] section — the socket is what is enabled at boot, not the app.
sleep_app_unit() {
  local wait
  wait="ExecStartPost=/bin/bash -c 'for i in \$\$(seq 1 300); do (echo > /dev/tcp/127.0.0.1/$3) 2>/dev/null && exit 0; sleep 0.1; done; exit 1'"
  awk -v bind="BindsTo=$2-wake.service" -v wait="$wait" '
    /^\[Install\]$/ { skip = 1 }
    skip { next }
    { print }
    /^\[Unit\]$/ { print bind }
    /^ExecStart=/ { print wait }
  ' <<<"$1"
}

# wake_socket_unit <name> <port>
wake_socket_unit() {
  cat <<UNIT
[Unit]
Description=$1 — listens while the app sleeps; the first request wakes it (generated by sync-infra.sh)

[Socket]
ListenStream=127.0.0.1:$2

[Install]
WantedBy=sockets.target
UNIT
}

# wake_proxy_unit <name> <inner-port>
wake_proxy_unit() {
  cat <<UNIT
[Unit]
Description=$1 — forwards to the app and lets it sleep after $SLEEP_IDLE_TIME idle (generated by sync-infra.sh)
Requires=$1-app.service
After=$1-app.service

[Service]
ExecStart=/usr/lib/systemd/systemd-socket-proxyd --exit-idle-time=$SLEEP_IDLE_TIME 127.0.0.1:$2
UNIT
}
