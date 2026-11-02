#!/usr/bin/env bash
# Take a site down — off the public internet, behind a password, or gone.
#
# new-site.sh creates seven things: a GitHub repository, a row in apps.conf
# (which allocates a port), a checkout on the box, /opt/<slug> (app, releases,
# shared/.env, uploads), a systemd unit, a Caddy vhost, and a monitoring
# target. Until this script existed, the product could create all seven and
# undo exactly one of them — the repository — so "delete the project" left a
# site serving to the whole internet on a wildcard DNS record, with a
# certificate, and a port nobody could reclaim.
#
# The Caddy vhost is the public switch. Wildcard DNS (*.orangecat.ch) points
# every name at this box, so a site is reachable if and only if a server block
# claims its host: remove /etc/caddy/apps.d/<slug>.caddy and the name stops
# resolving to anything servable, immediately, without touching the app.
#
# MODES, least to most destructive:
#   offline   stop the app, remove the vhost. Everything else kept. Reversible
#             with --mode restore. This is the honest answer to "make it not
#             public" — nothing is destroyed, and it takes effect at once.
#   private   keep it serving, behind HTTP basic auth, and make the repository
#             private. For showing a client work in progress.
#   restore   the inverse of offline/private: regenerate unit + vhost from
#             apps.conf and start the app again.
#   delete    everything on the box: unit, vhost, /opt/<slug>, the checkout,
#             the apps.conf row (which frees the port), the monitoring target.
#             The repository is handled separately (--repo), because deleting a
#             repository is the one step nobody can undo.
#
# A PLAN IS PRINTED AND NOTHING HAPPENS unless --go is passed. That is the
# default on purpose: every other script here defaults to doing the thing, and
# every other script here is additive.
#
# --no-github   no GitHub step at all: the repository is kept, its workflows
#               stay enabled and its secrets stay. For a site that is only to
#               leave the box (orangecat-2, 2026-11-01).
# --keep-data   with delete: keep /opt/<slug> and the checkout; everything
#               that serves it (unit, wake socket, vhost, row) still goes.
#
# Usage:
#   retire-site.sh <slug> --mode offline|private|restore|delete [--go]
#                         [--repo keep|private|archive|delete] [--force-client]
#                         [--no-github] [--keep-data]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SLUG=""; MODE=""; GO=0; REPO_ACTION=""; FORCE_CLIENT=0; NO_GITHUB=0; KEEP_DATA=0
while [ $# -gt 0 ]; do
  case "$1" in
    --mode)         MODE="${2:-}"; shift 2 ;;
    --repo)         REPO_ACTION="${2:-}"; shift 2 ;;
    --go)           GO=1; shift ;;
    --force-client) FORCE_CLIENT=1; shift ;;
    --no-github)    NO_GITHUB=1; shift ;;
    --keep-data)    KEEP_DATA=1; shift ;;
    -h|--help)      sed -n '2,45p' "$0"; exit 0 ;;
    -*)             echo "ERROR: unknown flag $1" >&2; exit 2 ;;
    *)              [ -z "$SLUG" ] && SLUG="$1" || { echo "ERROR: one slug at a time" >&2; exit 2; }; shift ;;
  esac
done

[ -n "$SLUG" ] || { echo "ERROR: which site? usage: retire-site.sh <slug> --mode offline|private|restore|delete" >&2; exit 2; }
case "$MODE" in
  offline|private|restore|delete) ;;
  "") echo "ERROR: --mode is required (offline, private, restore, delete)" >&2; exit 2 ;;
  *)  echo "ERROR: unknown mode '$MODE'" >&2; exit 2 ;;
esac

# Infrastructure and identity. These are not sites the product created and must
# never be retired by it — taking loki or the bridge off Caddy would end
# the session doing it, and 'orangecat' is the apex the rest hang from.
PROTECTED="bridge loki orangecat bitbaum supabase solon evig revampit hirnli-tenants datacat-api datacat-web root system"
for p in $PROTECTED; do
  [ "$SLUG" = "$p" ] && { echo "ERROR: '$SLUG' is infrastructure — refusing." >&2; exit 3; }
done

app_lookup "$SLUG"   # sets NAME PORT DOMAINS REPO APP_DIR DB OWNER KIND STATUS ...

# Money is the one thing this script will not decide by itself. A live client
# engagement has terms in the register; taking it down is a conversation, not a
# command, so it needs a second, explicit hand.
case "${KIND:-}" in
  client-app|client-site)
    if [ "${STATUS:-}" = "live" ] && [ "$FORCE_CLIENT" != 1 ]; then
      echo "ERROR: $SLUG is a LIVE client engagement ($KIND, owner ${OWNER:-?})." >&2
      echo "       Retiring it is a conversation first. Pass --force-client when it has been had." >&2
      exit 3
    fi ;;
esac

GH_OWNER_PREVIEW="${GITHUB_REPO_OWNER:-bitbaum}"

# The repository default follows the mode: a private site wants a private repo,
# a deleted site wants its repo archived (recoverable) rather than deleted.
if [ -z "$REPO_ACTION" ]; then
  case "$MODE" in
    private) REPO_ACTION="private" ;;
    delete)  REPO_ACTION="archive" ;;
    *)       REPO_ACTION="keep" ;;
  esac
fi
case "$REPO_ACTION" in keep|private|archive|delete) ;; *) echo "ERROR: unknown --repo '$REPO_ACTION'" >&2; exit 2 ;; esac
if [ "$NO_GITHUB" = 1 ] && [ "$REPO_ACTION" != keep ]; then
  echo "ERROR: --no-github keeps the repository as it is; --repo $REPO_ACTION contradicts it" >&2; exit 2
fi

# A renamed repository still answers under its old name: GitHub redirects
# repos/<owner>/<old> to the new one. Retiring the old site after a rename
# (signin -> morulia, 2026-11-01) would then disable the NEW site's workflows,
# delete its deploy key and archive it. So every GitHub step below is skipped
# when the repository now belongs to another name; the box steps still run.
# A lookup that fails (no gh, no repo) changes nothing.
REPO_ELSEWHERE=""
if [ "$NO_GITHUB" != 1 ] && canonical="$(gh api "repos/$GH_OWNER_PREVIEW/$SLUG" --jq .full_name 2>/dev/null)" \
   && [[ "$canonical" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
   && [ "$(tr '[:upper:]' '[:lower:]' <<<"$canonical")" != "$(tr '[:upper:]' '[:lower:]' <<<"$GH_OWNER_PREVIEW/$SLUG")" ]; then
  REPO_ELSEWHERE="$canonical"
  REPO_ACTION="keep"
fi

# Deleting a repository needs GitHub's delete_repo scope, which this host's
# token deliberately does not carry. Say so while it is still a PLAN — the
# moment to learn that a step cannot happen is before choosing it — and refuse
# outright only when asked to carry it out, so nothing is torn down first.
REPO_DELETE_BLOCKED=""
if [ "$REPO_ACTION" = "delete" ] && ! gh auth status 2>&1 | grep -q "delete_repo"; then
  REPO_DELETE_BLOCKED=1
  if [ "$GO" = 1 ]; then
    echo "ERROR: this host's GitHub token cannot delete repositories (no delete_repo scope)." >&2
    echo "       Use --repo archive, which is recoverable, or delete it yourself at" >&2
    echo "       https://github.com/$GH_OWNER_PREVIEW/$SLUG/settings" >&2
    exit 2
  fi
fi

HOST="${DOMAINS%%,*}"
GH_OWNER="${GITHUB_REPO_OWNER:-bitbaum}"

UNIT="$SLUG-app"
# A site that sleeps when idle (lib.sh) is woken by $SLUG-wake.socket, which
# holds its port and starts the app on the first connection. Stopping only the
# app left the socket listening: the port stayed taken, and any local request
# brought the "offline" app back up.
WAKE="$SLUG-wake.socket $SLUG-wake.service"
VHOST="/etc/caddy/apps.d/$SLUG.caddy"
BOX_DEV="${BOX_DEV_ROOT:-/home/ubuntu/dev}/$SLUG"
# The box's own register (register-site.sh writes there first). Run from a
# workflow, $MANIFEST is the runner's copy of main's, so removing the row there
# alone left it on the box: orangecat-2 was retired on 2026-10-17 and was still
# in the box's register, holding 4035, two weeks later.
BOX_REGISTER="${BOX_LOKI:-/home/ubuntu/dev/loki}/scripts/hetzner/apps.conf"

say() { printf '  %s\n' "$*"; }
plan() { printf '  %s %s\n' "$( [ "$GO" = 1 ] && echo '→' || echo 'PLAN' )" "$*"; }
run() { if [ "$GO" = 1 ]; then box "$1"; else :; fi }

echo
echo "site     $SLUG  ($HOST, port $PORT, ${KIND:-?}/${STATUS:-?})"
echo "mode     $MODE   repository: $REPO_ACTION"
[ "$GO" = 1 ] || echo "         DRY RUN — nothing below has happened. Add --go to do it."
echo

# RETIRE_LOOK=1 (the workflow sets it): say what is on the box before
# planning to remove it. Read-only; names and states only.
if [ "${RETIRE_LOOK:-0}" = 1 ]; then
  echo "on the box now:"
  box "for u in $UNIT $WAKE; do printf '  %-34s %s, %s\\n' \"\$u\" \"\$(systemctl is-enabled \$u 2>/dev/null; true)\" \"\$(systemctl is-active \$u 2>/dev/null; true)\"; done
    for p in /etc/systemd/system/$UNIT.service $VHOST /opt/$SLUG $BOX_DEV; do [ -e \"\$p\" ] && echo \"  present  \$p\" || echo \"  absent   \$p\"; done
    grep -q '^$SLUG|' '$BOX_REGISTER' 2>/dev/null && echo '  row      in the box register' || echo '  row      not in the box register'
    ss -Hltn 'sport = :$PORT' 2>/dev/null | grep -q . && echo '  port     $PORT has a listener' || echo '  port     $PORT is free'" \
    || say "(could not look at the box)"
  echo
fi

case "$MODE" in
  offline|delete)
    plan "stop and disable $UNIT and its wake socket, if any (the app stops answering, the port is let go)"
    run "sudo systemctl disable --now $SLUG-wake.socket 2>/dev/null || true; sudo systemctl stop $SLUG-wake.service 2>/dev/null || true; sudo systemctl disable --now $UNIT 2>/dev/null || true"
    plan "remove $VHOST and reload Caddy ($HOST stops being served)"
    run "sudo rm -f $VHOST && sudo caddy validate --config /etc/caddy/Caddyfile >/dev/null && sudo systemctl reload caddy"
    ;;
  private)
    # A password, not a takedown: the site keeps working for anyone who has it.
    # Generated here and shown once — this script never stores it.
    if [ "$GO" = 1 ]; then
      PASS="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)"
      HASH="$(box "caddy hash-password --plaintext '$PASS'")"
      box "sudo tee $VHOST >/dev/null <<CADDY_EOF
$HOST {
  encode zstd gzip
  basic_auth {
    preview $HASH
  }
  reverse_proxy 127.0.0.1:$PORT {
    flush_interval -1
    lb_try_duration 20s
    lb_try_interval 250ms
  }
}
CADDY_EOF
sudo caddy validate --config /etc/caddy/Caddyfile >/dev/null && sudo systemctl reload caddy"
      say "$HOST now asks for a password."
      say "  user: preview"
      say "  pass: $PASS      ← shown once, not stored anywhere"
    else
      plan "replace $VHOST with a basic_auth vhost (user 'preview', generated password shown once)"
      plan "reload Caddy — $HOST keeps serving, but only with the password"
    fi
    ;;
  restore)
    plan "regenerate the unit and vhost from apps.conf (sync-infra.sh $SLUG)"
    if [ "$GO" = 1 ]; then bash "$HERE/sync-infra.sh" "$SLUG"; fi
    plan "start $UNIT"
    run "sudo systemctl enable --now $UNIT"
    say "$HOST is public again once the app answers on $PORT."
    ;;
esac

if [ "$MODE" = "delete" ]; then
  plan "remove the unit files ($UNIT, $SLUG-wake.socket/.service) and reload systemd"
  run "sudo rm -f /etc/systemd/system/$UNIT.service /etc/systemd/system/$SLUG-wake.socket /etc/systemd/system/$SLUG-wake.service && sudo systemctl daemon-reload && sudo systemctl reset-failed $UNIT $WAKE 2>/dev/null || true"
  if [ "$KEEP_DATA" = 1 ]; then
    plan "keep /opt/$SLUG and the checkout at $BOX_DEV (--keep-data)"
  else
    plan "remove /opt/$SLUG (app, releases, shared/.env, uploads)"
    run "sudo rm -rf /opt/$SLUG"
    plan "remove the checkout at $BOX_DEV"
    run "rm -rf $BOX_DEV"
  fi
  plan "remove the row from the box's register ($BOX_REGISTER)"
  run "exec 9>/tmp/loki-register-site.lock; flock -w 60 -x 9 && [ -f '$BOX_REGISTER' ] && sed -i '/^$SLUG|/d' '$BOX_REGISTER' || true"
  plan "remove the apps.conf row, freeing port $PORT"
  if [ "$GO" = 1 ]; then
    tmp="$(mktemp)"; grep -v "^$SLUG|" "$MANIFEST" > "$tmp" && mv "$tmp" "$MANIFEST"
    say "row removed from $MANIFEST — commit it, or the register still claims the site:"
    say "  git -C $(dirname "$MANIFEST")/../.. add scripts/hetzner/apps.conf && git commit -m 'chore(register): retire $SLUG'"
  fi
  plan "refresh the watchdog's monitored targets (so it stops alerting on a site that is gone)"
  if [ "$GO" = 1 ] && [ -x "$HERE/install-watchdog.sh" ]; then bash "$HERE/install-watchdog.sh" >/dev/null 2>&1 || say "watchdog refresh failed — run install-watchdog.sh by hand"; fi
fi

# A retired site's repository keeps deploying it. deploy.yml fires on every push
# to main and tries to rsync to a box path that no longer exists; ci.yml and
# auto-merge.yml keep merging agent PRs into a project that is gone. Disabling
# is the right verb rather than deleting the files: it stops the runs without a
# commit, and gh workflow enable brings them back if the site is rebuilt.
#
# Before the repository is archived, because an archived repository refuses
# every mutation — including this one.
if [ -n "$REPO_ELSEWHERE" ]; then
  plan "$GH_OWNER/$SLUG was renamed to $REPO_ELSEWHERE: no GitHub step runs (its workflows, deploy key and repository belong to that site now)"
fi

if [ "$NO_GITHUB" = 1 ]; then
  plan "no GitHub step (--no-github): $GH_OWNER/$SLUG, its workflows and its secrets are left as they are"
fi

if [ "$MODE" = "delete" ] && [ -z "$REPO_ELSEWHERE" ] && [ "$NO_GITHUB" != 1 ]; then
  plan "disable the repository's GitHub Actions workflows (they would keep deploying a site that is gone)"
  if [ "$GO" = 1 ]; then
    ids=$(gh api "repos/$GH_OWNER/$SLUG/actions/workflows" --jq '.workflows[] | select(.state=="active") | .id' 2>/dev/null || true)
    if [ -z "$ids" ]; then
      say "no active workflows to disable"
    else
      for wf in $ids; do
        gh api -X PUT "repos/$GH_OWNER/$SLUG/actions/workflows/$wf/disable" >/dev/null 2>&1 \
          && say "workflow $wf disabled" \
          || say "could not disable workflow $wf"
      done
    fi
  fi
fi

# The box's SSH deploy key lives in the repository as HETZNER_SSH_PRIVATE_KEY
# (register-site.sh sets it). Nothing ever removed it, so every retired site
# kept a working key to this box in a repository that may outlive the site —
# and may later be made public or handed over.
if [ "$MODE" = "delete" ] && [ "$REPO_ACTION" != "delete" ] && [ -z "$REPO_ELSEWHERE" ] && [ "$NO_GITHUB" != 1 ]; then
  plan "remove the HETZNER_SSH_PRIVATE_KEY secret from $GH_OWNER/$SLUG (a key to this box)"
  if [ "$GO" = 1 ]; then
    gh secret delete HETZNER_SSH_PRIVATE_KEY --repo "$GH_OWNER/$SLUG" >/dev/null 2>&1 \
      && say "deploy secret removed" \
      || say "could not remove the deploy secret — do it by hand if the repo survives"
  fi
fi

case "$REPO_ACTION" in
  keep)    plan "repository ${REPO_ELSEWHERE:-$GH_OWNER/$SLUG} left as it is" ;;
  private) plan "make $GH_OWNER/$SLUG private"
           if [ "$GO" = 1 ]; then gh api -X PATCH "repos/$GH_OWNER/$SLUG" -F private=true >/dev/null && say "repository is private"; fi ;;
  archive) plan "archive $GH_OWNER/$SLUG (read-only, recoverable)"
           if [ "$GO" = 1 ]; then gh api -X PATCH "repos/$GH_OWNER/$SLUG" -F archived=true >/dev/null && say "repository archived"; fi ;;
  delete)  plan "DELETE $GH_OWNER/$SLUG — this cannot be undone"
           if [ -n "$REPO_DELETE_BLOCKED" ]; then
             plan "...but this host's token has no delete_repo scope, so --go would refuse. Use --repo archive."
           fi
           if [ "$GO" = 1 ]; then gh repo delete "$GH_OWNER/$SLUG" --yes && say "repository deleted"; fi ;;
esac

echo
# What is reversible, and how, belongs in the PLAN as much as in the result —
# the moment to learn that "offline" can be undone is before choosing it.
case "$MODE" in
  offline|private)
    echo "Reversible. Put it back with:"
    echo "    bash scripts/hetzner/retire-site.sh $SLUG --mode restore --go" ;;
  delete)
    if [ "$KEEP_DATA" = 1 ]; then
      echo "NOT reversible on the box: the unit, the vhost and the row are gone. /opt/$SLUG and its checkout are kept."
    else
      echo "NOT reversible on the box: /opt, the unit, the vhost and the row are gone for good."
    fi
    case "$REPO_ACTION" in
      archive) echo "The repository is only archived, so the code survives — unarchive it to rebuild." ;;
      delete)  echo "The repository is deleted too. Nothing of this site survives anywhere." ;;
      *)       echo "The repository is untouched, so the code survives." ;;
    esac ;;
esac
echo
if [ "$GO" = 1 ]; then
  case "$MODE" in
    offline) echo "✓ $HOST is no longer served. Everything else is intact." ;;
    private) echo "✓ $HOST is behind a password." ;;
    restore) echo "✓ $HOST is back." ;;
    delete)  echo "✓ $SLUG is gone from the box. Commit the apps.conf change." ;;
  esac
else
  echo "Nothing happened. Re-run with --go to carry out the plan above."
fi
