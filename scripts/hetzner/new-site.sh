#!/usr/bin/env bash
#
# Spin up a new site: repo → register → box → deploy. One command.
#
# Already have a GitHub repo (e.g. Loki kickoff provision)? Use
# register-site.sh instead — same CD registration without scaffolding.
#
#   new-site.sh <slug> [--title "Name"] [--owner X] [--kind K] [--status S]
#               [--plan P] [--price N]
#               [--private] [--no-deploy] [--dry-run]
#
# --plan/--price are REQUIRED when --kind is client-app/client-site and --status
# is live: the register's terms columns exist to answer "what am I owed this
# month", and a live engagement that leaves them '-' is the case they exist for.
#
# PUBLIC BY DEFAULT, because that is how this studio actually works: 37 of 41
# repos are public. It is also what makes organisation secrets usable — GitHub
# Free does not expose org-level secrets to PRIVATE repositories, so a fleet of
# private repos is a fleet that needs the deploy key copied into every one.
#
# Use --private when the repository contains something that is not ours to
# publish. camille-boulangerie is the example: it holds a scrape manifest of a
# real bakery's site, and publishing that under an invented brand is a different
# act from publishing our own code.
#
# WHY THIS EXISTS
#
# Substrata was created by hand on 2026-08-27. It took nine steps, and the two
# that got skipped when the same thing was done for Camille a week earlier were
# the two with no visible payoff on the day: creating the repository, and
# registering it. Camille then ran in production for eight days with no version
# control and no entry in apps.conf, which meant the studio's central claim —
# that a client can be handed their site — was untestable for the very site
# built to demonstrate it.
#
# So this automates the boring steps specifically. The interesting ones (design,
# content) are meant to be done by a human afterwards.
#
# WHAT IT DOES NOT DO
#
#   - It does not READ the deploy key. It pipes DEPLOY_KEY_PATH straight into
#     `gh secret set`, so the key never enters a variable, a log or an agent's
#     context — but the step is automatic. An earlier version printed the
#     command instead and called that operator hygiene; what it actually
#     produced was substrata sitting in production for a day deploying only
#     from a laptop, because a printed instruction is a step that gets skipped.
#     The secret is set per-repo on purpose: GitHub Free does not expose
#     org-level secrets to PRIVATE repositories, so an org secret alone would
#     silently cover only half the fleet.
#   - It creates the Loki project and widget token (provision-widget.ts),
#     but treats failure as non-fatal: a site without a widget is fixable in a
#     minute, whereas aborting halfway leaves a half-registered site on the box.
#
# Every step is idempotent or refuses. Nothing is clobbered.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$HERE/lib.sh"

SECRET_OK=0
SLUG=""; TITLE=""; OWNER="bitbaum"; KIND="client-site"; STATUS="prospect"
VISIBILITY="--public"; DEPLOY=1; DRY=0
# '-' is the register's word for NOT KNOWN, and it is the honest default for a
# prospect. It stops being honest the moment --status live is passed for client
# work; see the refusal below.
PLAN="-"; PRICE="-"
# DEV_ROOT, GH_OWNER and SITES_BASE_DOMAIN come from _box-env.sh via lib.sh —
# the studio's env SSOT. Do not redeclare them here; a second copy is how a
# rename becomes a hunt.
BASE_DOMAIN="$SITES_BASE_DOMAIN"

while [ $# -gt 0 ]; do
  case "$1" in
    --title)  TITLE="$2"; shift 2 ;;
    --owner)  OWNER="$2"; shift 2 ;;
    --kind)   KIND="$2"; shift 2 ;;
    --status) STATUS="$2"; shift 2 ;;
    --plan)   PLAN="$2"; shift 2 ;;
    --price)  PRICE="$2"; shift 2 ;;
    --private) VISIBILITY="--private"; shift ;;
    --no-deploy) DEPLOY=0; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)  [ -z "$SLUG" ] && SLUG="$1" || { echo "unexpected arg: $1" >&2; exit 2; }; shift ;;
  esac
done

[ -n "$SLUG" ] || { echo "usage: new-site.sh <slug> [--title \"Name\"]" >&2; exit 2; }
[ -n "$TITLE" ] || TITLE="$SLUG"

# Refused HERE, before the repo, the box and the deploy — not by CI afterwards.
# check-client-ledger.sh will reject this row anyway, but by then the site is
# created, pushed and serving, and the only way out is a follow-up commit. The
# question "what is this client paying" is answerable at the moment someone
# types the command and at no cheaper moment ever again.
case "$KIND" in
  client-app|client-site)
    if [ "$STATUS" = live ] && { [ "$PLAN" = "-" ] || [ "$PRICE" = "-" ]; }; then
      echo "✗ --status live on $KIND needs --plan and --price." >&2
      echo "  A live client engagement with unrecorded terms is work being done" >&2
      echo "  for an amount nobody can state; scripts/ci/check-client-ledger.sh" >&2
      echo "  would fail the PR that registers it." >&2
      echo "  Not settled yet? Register it as --status prospect and flip it to" >&2
      echo "  live with the terms once it is." >&2
      exit 2
    fi
    ;;
esac

say() { printf '  %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then printf '  DRY  %s\n' "$*"; else eval "$@"; fi; }

# ---------------------------------------------------------------- validation
# A slug becomes a DNS label, a certificate subject, a directory and a systemd
# unit. Everything downstream assumes it is safe, so it is checked once, here.
echo "→ validating '$SLUG'"
[[ "$SLUG" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] \
  || { echo "✗ slug must be lowercase letters, digits and hyphens, not starting or ending with one" >&2; exit 1; }

if grep -q "^$SLUG|" "$MANIFEST" 2>/dev/null; then
  echo "✗ '$SLUG' is already in $MANIFEST" >&2; exit 1
fi

# A label already serving something on the box must never be reused: the new
# site would either be shadowed by that Caddy block or shadow it.
if grep -v '^#' "$MANIFEST" | cut -d'|' -f3 | tr ',' '\n' | grep -qx "$SLUG.$BASE_DOMAIN"; then
  echo "✗ $SLUG.$BASE_DOMAIN is already served by another entry" >&2; exit 1
fi
for reserved in www api app admin support security billing pay wallet login auth account \
                mail smtp imap ns1 ns2 mx cdn static assets vpn db status staging dev test \
                preview bridge loki orangecat supabase solon evig revampit root system; do
  [ "$SLUG" = "$reserved" ] && { echo "✗ '$SLUG' is reserved (infrastructure or impersonation risk)" >&2; exit 1; }
done

REPO_DIR="$DEV_ROOT/$SLUG"
[ -e "$REPO_DIR" ] && { echo "✗ $REPO_DIR already exists" >&2; exit 1; }

# ------------------------------------------------------------ port allocation
# The register is the SSOT — but only the register on ORIGIN is.
#
# This reads a file in a local checkout, and this studio runs five to ten agent
# sessions at once, each in its own worktree. A checkout that is an hour old
# reports an hour-old highest port, so two sessions scaffolding in the same
# afternoon both pick the same number and the second site silently takes the
# first one's traffic. That is not hypothetical: on 2026-09-10 a stale checkout
# offered 4024 for a new site while diplodoctor already held 4024 and heidi held
# 4025 on origin. It was caught by hand, one command before it would have shipped.
#
# So: refuse rather than guess. A fetch is cheap and the failure it prevents is
# a port collision on a live box, which is expensive and confusing to unpick.
if git -C "$(dirname "$MANIFEST")" rev-parse --git-dir >/dev/null 2>&1; then
  if git -C "$(dirname "$MANIFEST")" fetch origin main --quiet 2>/dev/null; then
    REL="$(git -C "$(dirname "$MANIFEST")" ls-files --full-name "$MANIFEST" 2>/dev/null || true)"
    if [ -n "$REL" ] && ! git -C "$(dirname "$MANIFEST")" diff --quiet origin/main -- "$MANIFEST" 2>/dev/null; then
      echo "✗ $MANIFEST differs from origin/main." >&2
      echo "  Ports are allocated from this file, so an out-of-date copy hands out" >&2
      echo "  a number another session already took. Reconcile first:" >&2
      echo "    git -C $(dirname "$MANIFEST") pull --rebase" >&2
      echo "  (If your own unpushed register edit is the difference, push it.)" >&2
      exit 1
    fi
  else
    say "⚠ could not reach origin; port is allocated from a possibly stale register"
  fi
fi

# From the register, not from `ss -ltnp`. The register is the SSOT; a port that
# is free on the box but claimed here belongs to something not currently running.
PORT=$(grep -v '^#' "$MANIFEST" | cut -d'|' -f2 | grep -E '^[0-9]+$' | sort -n | tail -1)
PORT=$((PORT + 1))

# ...and then the other direction, which the line above cannot see: a port that
# is LIVE on the box but absent from the register. That is not a defect in the
# register — annushka's enquiry API holds 4030 behind a hand-written vhost on
# purpose, and the 4001-4004 services are excluded by design — but it means
# `max(registered)+1` was walking toward an occupied port. Both checks are
# needed: the register owns "claimed", the box owns "occupied".
#
# Announced, never silent: if the box cannot be reached, the sweep returns
# nothing, which is indistinguishable from "nothing is listening". Say which
# one happened rather than let an unchecked port look like a checked one.
TAKEN=$(listening_ports)
if [ -z "$TAKEN" ]; then
  say "port $PORT — next after the highest in the register, NOT verified against"
  say "     the box (could not read its listeners; check by hand before deploying)"
else
  FREE=$(next_free_port "$PORT" "$TAKEN")
  if [ "$FREE" != "$PORT" ]; then
    say "port $PORT is live on the box but unregistered — advancing to $FREE"
    PORT="$FREE"
  fi
  say "port $PORT (next after the highest in the register, verified free on the box)"
fi
say "host $SLUG.$BASE_DOMAIN  (wildcard DNS — no record needed)"
say "repo $GH_OWNER/$SLUG  ->  $REPO_DIR"

# ------------------------------------------------------------------- scaffold
echo "→ scaffolding"
TEMPLATE="$HERE/../site-template"
if [ "$DRY" = 0 ]; then
  mkdir -p "$REPO_DIR"
  cp -r "$TEMPLATE"/. "$REPO_DIR"/
  mv "$REPO_DIR/gitignore" "$REPO_DIR/.gitignore"
  # Placeholders are substituted in every text file, so a template file can use
  # them without this script knowing which files exist.
  grep -rl '__SLUG__\|__TITLE__\|__HOST__\|__WORKFLOW_OWNER__' "$REPO_DIR" 2>/dev/null | while read -r f; do
    sed -i "s|__SLUG__|$SLUG|g; s|__TITLE__|$TITLE|g; s|__HOST__|$SLUG.$BASE_DOMAIN|g; s|__WORKFLOW_OWNER__|$WORKFLOW_OWNER|g" "$f"
  done
  printf '# Runtime env. No secrets belong here — the box is the env SSOT.\nNODE_ENV=production\nNEXT_PUBLIC_APP_URL=https://%s.%s\n' "$SLUG" "$BASE_DOMAIN" > "$REPO_DIR/.env.selfhost.local"
  say "$(find "$REPO_DIR" -type f | wc -l) files"

  # Resolve a lockfile INTO the first commit.
  #
  # Without one the repository is born unbuildable in two places at once: CI
  # runs `pnpm install --frozen-lockfile`, which refuses to invent a lockfile,
  # and the box's deploy resolves versions afresh on every release, so the site
  # that was verified is not the site that ships. `--lockfile-only` writes
  # pnpm-lock.yaml without unpacking node_modules, which keeps this to a few
  # seconds and leaves nothing behind for .gitignore to catch.
  if command -v pnpm >/dev/null 2>&1; then
    if (cd "$REPO_DIR" && pnpm install --lockfile-only >/dev/null 2>&1); then
      say "pnpm-lock.yaml resolved"
    else
      say "⚠ could not resolve pnpm-lock.yaml — CI will fail on --frozen-lockfile"
      say "  Fix before merging:  cd $REPO_DIR && pnpm install --lockfile-only"
    fi
  else
    say "⚠ pnpm not found; no lockfile written (CI needs one)"
  fi
else
  say "DRY  would copy $TEMPLATE -> $REPO_DIR and substitute __SLUG__/__TITLE__/__HOST__"
fi

# ------------------------------------------------------------------- widget
# Before the repository, so the token is in the first commit's env file rather
# than arriving as an afterthought nobody deploys.
#
# NON-FATAL BY DESIGN. A site without a widget can be fixed in a minute; a
# scaffold that aborts here leaves a directory, no repo and no register entry,
# which is the mess this script exists to prevent.
echo "→ Loki project + widget token"
# provision-widget.ts prints the env fragment itself (widget token AND project
# id) so this script appends rather than reformats. Reformatting one named
# variable is how the project id would have been dropped in silence: the widget
# would work, the day-zero page's only button would fall back to the project
# list, and nothing anywhere would report a problem.
FC_ENV=""
# Carried to the final summary. A warning printed HERE scrolls off the top of a
# run that goes on to build a repo, a box and a deploy — diplodoctor's widget
# failed exactly this way and nobody noticed until the live page was read and
# found to contain no widget at all. Non-fatal must still mean visible at the
# end, next to the other things the operator has to finish.
WIDGET_TODO=""
if [ "$DRY" = 1 ]; then
  say "DRY  bash $HERE/provision-widget-on-box.sh $SLUG '$TITLE' $SLUG.$BASE_DOMAIN"
else
  # ON THE BOX, not here. Production Loki's database is
  # 127.0.0.1/loki — loopback only — so a laptop cannot reach it, and an
  # agent worktree has no DATABASE_URL at all (.env.local is gitignored and
  # never leaves the main checkout). Running it locally failed on EVERY
  # scaffold, silently, and every agent-created site up to 2026-09-11 went live
  # with no feedback widget as a result.
  FC_ENV=$(bash "$HERE/provision-widget-on-box.sh" "$SLUG" "$TITLE" "$SLUG.$BASE_DOMAIN" 2>/dev/null || true)
  if [ -n "$FC_ENV" ]; then
    printf '%s\n' "$FC_ENV" >> "$REPO_DIR/.env.selfhost.local"
    say "project + token provisioned on the box, written to .env.selfhost.local"
  else
    say "⚠ could not provision a widget token."
    say "  Run it directly to see why — it reports the cause on stderr:"
    say "    bash $HERE/provision-widget-on-box.sh $SLUG '$TITLE' $SLUG.$BASE_DOMAIN"
    # NOTE THE SECOND COMMAND. Appending to .env.selfhost.local is enough only
    # BEFORE the first deploy: deploy.sh seeds /opt/<name>/shared/.env from this
    # file only when the box has none, and the box is the env SSOT from then on.
    # After that, appending here changes nothing at all — the build reads the
    # box's copy — so the repair needs --env to push the new value up.
    # NEXT_PUBLIC_* is inlined at BUILD time, which is why this is a redeploy
    # and not a restart.
    WIDGET_TODO="
  4. This site has NO feedback widget, so its owner cannot change it without
     asking a person — which is the dependency this scaffold exists to remove.
     Provision it and push the value to the box:
       bash $HERE/provision-widget-on-box.sh $SLUG '$TITLE' $SLUG.$BASE_DOMAIN \\
         >> $REPO_DIR/.env.selfhost.local
       bash $HERE/deploy.sh $SLUG --env
     Then confirm it actually renders — the token existing proves nothing:
       curl -s https://$SLUG.$BASE_DOMAIN | grep -c data-fc-project
"
  fi
fi

# ----------------------------------------------------------------- repository
# Before anything else reaches the box. A site that is not in a repository
# cannot be handed to anyone, and that is the step that gets skipped.
echo "→ repository"
run "cd '$REPO_DIR' && git init -q && git add -A && git -c user.name=\"$GIT_SCAFFOLD_NAME\" -c user.email=\"$GIT_SCAFFOLD_EMAIL\" commit -q -m 'feat: scaffold $TITLE' && git branch -M main"
run "cd '$REPO_DIR' && gh repo create '$GH_OWNER/$SLUG' $VISIBILITY --source=. --remote=origin --push"

# ----------------------------------------------------------------- ci secret
# Without this the repo's deploy.yml is decoration: it runs, fails to reach the
# box, and the site is live only as long as someone's laptop is. Piped, never
# read. Non-fatal, like the widget: a site that exists beats one that aborted.
echo "→ ci secret"
if [ "$DRY" = 1 ]; then
  say "DRY  gh secret set HETZNER_SSH_PRIVATE_KEY --repo $GH_OWNER/$SLUG < $DEPLOY_KEY_PATH"
elif [ ! -r "$DEPLOY_KEY_PATH" ]; then
  SECRET_OK=0
  say "no key at $DEPLOY_KEY_PATH — CD will not reach the box."
  say "  set DEPLOY_KEY_PATH, or: gh secret set HETZNER_SSH_PRIVATE_KEY --repo $GH_OWNER/$SLUG < <key>"
elif gh secret set HETZNER_SSH_PRIVATE_KEY --repo "$GH_OWNER/$SLUG" < "$DEPLOY_KEY_PATH" 2>/dev/null; then
  SECRET_OK=1
  say "HETZNER_SSH_PRIVATE_KEY set on $GH_OWNER/$SLUG"
else
  SECRET_OK=0
  say "could not set the secret (gh auth?) — CD will not reach the box until it is set."
fi

# ------------------------------------------------------------------- register
echo "→ register"
LINE="$SLUG|$PORT|$SLUG.$BASE_DOMAIN|$REPO_DIR|.|-|$OWNER|$KIND|$STATUS|$PLAN|$PRICE|$(date -u +%Y-%m-%d)"
if [ "$DRY" = 1 ]; then say "DRY  append: $LINE"; else
  printf '%s\n' "$LINE" >> "$MANIFEST"
  say "appended to $MANIFEST"
fi

# ------------------------------------------------------------------------ box
echo "→ box (systemd unit, launch.sh, Caddy vhost, monitoring)"
run "bash '$HERE/sync-infra.sh' '$SLUG'"

# --------------------------------------------------------------------- deploy
if [ "$DEPLOY" = 1 ]; then
  echo "→ deploy"
  run "bash '$HERE/deploy.sh' '$SLUG'"
fi

# ----------------------------------------------------------------------- next
if   [ "$DRY" = 1 ];      then SECRET_OK_LABEL="would be set from $DEPLOY_KEY_PATH"
elif [ "$SECRET_OK" = 1 ]; then SECRET_OK_LABEL="set — push deploys"
else                            SECRET_OK_LABEL="NOT set — CD cannot reach the box"; fi
cat <<NEXT

✓ $TITLE

  live      https://$SLUG.$BASE_DOMAIN
  repo      https://github.com/$GH_OWNER/$SLUG
  register  $SLUG|$PORT|... in apps.conf

  ci        deploy key ${SECRET_OK_LABEL}

  Still yours to do:

  1. Change app/globals.css. It ships in Loki's palette on purpose, so a
     new site reads as "made with Loki" rather than "generated" — but a
     bespoke site that STAYS in it is the one thing this studio must not ship.

  2. Commit the register change:
       cd $(dirname "$MANIFEST") && git add apps.conf && git commit

  3. If this project is public on OrangeCat, point the day-zero page at it.
     The page links it as a SECONDARY action (Loki stays the button):
       echo NEXT_PUBLIC_OC_PROJECT_ID=<uuid> >> $REPO_DIR/.env.selfhost.local
       bash $HERE/deploy.sh $SLUG --env
     There is no OrangeCat project by default — new-site.sh does not create one,
     so the link simply does not render until this is set. That is deliberate:
     a link to a page that does not exist is worse than no link.
${WIDGET_TODO}
NEXT
