#!/usr/bin/env bash
#
# Register an ALREADY-EXISTING GitHub repo for Hetzner CD.
#
#   register-site.sh <slug> --repo OWNER/NAME [--title "Name"]
#                     [--owner X] [--kind K] [--status S]
#                     [--plan P] [--price N]
#                     [--no-deploy] [--dry-run]
#
# This is the CD half of new-site.sh without scaffolding a new repo.
# Loki kickoff / provision creates the GitHub repo (agent starters);
# this script does what Make it happen could not safely invent: apps.conf
# row, deploy secret, sync-infra, and (unless --no-deploy) first deploy.
#
# Idempotent: existing apps.conf row with the same slug (compatible repo path)
# succeeds — re-ensures deploy.yml + secret + sync-infra, prints live URL, does
# not fail as "already exists". deploy.yml is added/repaired when missing;
# secret set is overwrite-safe.
#
# Prints the live URL on success (and always ends with a summary block).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$HERE/lib.sh"

SECRET_OK=0
SLUG=""; REPO_REF=""; TITLE=""; OWNER="bitbaum"; KIND="client-site"; STATUS="prospect"
DEPLOY=1; DRY=0
PLAN="-"; PRICE="-"
BASE_DOMAIN="$SITES_BASE_DOMAIN"
# Prefer the durable studio checkout for apps.conf — writing the /opt release
# copy is lost on the next loki deploy.
FC_REPO="${LOKI_REPO_ROOT:-$DEV_ROOT/loki}"
if [ -f "$FC_REPO/scripts/hetzner/apps.conf" ]; then
  MANIFEST="$FC_REPO/scripts/hetzner/apps.conf"
  SYNC_INFRA="$HERE/sync-infra.sh"
  DEPLOY_SH="$HERE/deploy.sh"
else
  # Release /opt copy, or a checkout that only has the script beside apps.conf.
  # Prefer durable FC_REPO when present; never leave MANIFEST unset.
  MANIFEST="$HERE/apps.conf"
  SYNC_INFRA="$HERE/sync-infra.sh"
  DEPLOY_SH="$HERE/deploy.sh"
fi
[ -f "$MANIFEST" ] || { echo "✗ scripts/hetzner/apps.conf missing at $MANIFEST (set LOKI_REPO_ROOT to the durable loki checkout)" >&2; exit 1; }
# The register beside this script is the one main last shipped. The durable
# checkout can lag main (rows land there only on a pull nobody triggers) and
# main can lag the durable checkout (rows appended here reach main only when
# someone commits them). Ports are allocated and conflicts checked against
# BOTH, or a port main already gave away gets handed out again — velokiosk
# took 4024 on 2026-09-10 while diplodoctor was listening on it.
RELEASE_MANIFEST="$HERE/apps.conf"
registers() { printf '%s\n' "$MANIFEST"; [ "$RELEASE_MANIFEST" != "$MANIFEST" ] && [ -f "$RELEASE_MANIFEST" ] && printf '%s\n' "$RELEASE_MANIFEST"; return 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)   REPO_REF="$2"; shift 2 ;;
    --title)  TITLE="$2"; shift 2 ;;
    --owner)  OWNER="$2"; shift 2 ;;
    --kind)   KIND="$2"; shift 2 ;;
    --status) STATUS="$2"; shift 2 ;;
    --plan)   PLAN="$2"; shift 2 ;;
    --price)  PRICE="$2"; shift 2 ;;
    --no-deploy) DEPLOY=0; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)  [ -z "$SLUG" ] && SLUG="$1" || { echo "unexpected arg: $1" >&2; exit 2; }; shift ;;
  esac
done

[ -n "$SLUG" ] || { echo "usage: register-site.sh <slug> --repo OWNER/NAME" >&2; exit 2; }
[ -n "$REPO_REF" ] || { echo "usage: register-site.sh <slug> --repo OWNER/NAME" >&2; exit 2; }
[ -n "$TITLE" ] || TITLE="$SLUG"
# Child tools must read the exact canonical register we update, even when the
# executable comes from the current release and the register is durable.
export MANIFEST
if [ "$DRY" != 1 ]; then
  exec 9>"${TMPDIR:-/tmp}/loki-register-site.lock"
  flock -w 60 -x 9 || { echo "ERROR: another registration is still running; retry shortly" >&2; exit 1; }
fi

case "$KIND" in
  client-app|client-site)
    if [ "$STATUS" = live ] && { [ "$PLAN" = "-" ] || [ "$PRICE" = "-" ]; }; then
      echo "✗ --status live on $KIND needs --plan and --price." >&2
      exit 2
    fi
    ;;
esac

say() { printf '  %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then printf '  DRY  %s\n' "$*"; else eval "$@"; fi; }
# The register is a file in git; a row that exists only on this box is lost to
# the next clone and invisible to CI's uniqueness check. Send it to main the
# way every other change gets there: a branch, a PR, the sweep. Best-effort —
# the site is registered here either way — but always announced.
publish_register_row() {
  local line="$1" fc_git wt branch
  fc_git="$(dirname "$(dirname "$(dirname "$MANIFEST")")")"
  git -C "$fc_git" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { say "register row not published: $fc_git is not a git checkout"; return 0; }
  branch="register/$SLUG"
  wt="$(mktemp -d)/fc"
  if git -C "$fc_git" fetch -q origin main 2>/dev/null \
     && git -C "$fc_git" worktree add -q -B "$branch" "$wt" origin/main 2>/dev/null; then
    if grep -q "^$SLUG|" "$wt/scripts/hetzner/apps.conf"; then
      say "register row already on main"
    else
      printf '%s\n' "$line" >> "$wt/scripts/hetzner/apps.conf"
      if git -C "$wt" -c user.name="$GIT_SCAFFOLD_NAME" -c user.email="$GIT_SCAFFOLD_EMAIL" \
           commit -q -am "chore(register): add $SLUG ($PORT)" \
         && env -u GH_TOKEN -u GITHUB_TOKEN git -C "$wt" push -q -f -u origin "$branch" 2>/dev/null \
         && pr=$(env -u GH_TOKEN -u GITHUB_TOKEN gh pr create --repo "$(git -C "$fc_git" remote get-url origin | sed -E 's#^https://github.com/##; s#^git@github.com:##; s#\.git$##')" \
                 --head "$branch" --base main --title "chore(register): add $SLUG ($PORT)" \
                 --body "Registered from the box by register-site.sh. Row: \`$line\`" 2>/dev/null); then
        say "register row sent to main: $pr"
      else
        say "⚠ register row not published to main (push or PR failed) — the durable register still has it"
      fi
    fi
    git -C "$fc_git" worktree remove -f "$wt" >/dev/null 2>&1 || true
  else
    say "⚠ register row not published to main (could not fetch or branch)"
  fi
  rm -rf "$(dirname "$wt")"
  return 0
}

# Normalize OWNER/NAME from a URL if needed.
if [[ "$REPO_REF" == https://github.com/* ]] || [[ "$REPO_REF" == git@github.com:* ]]; then
  REPO_REF=$(printf '%s' "$REPO_REF" | sed -E 's#^https://github.com/##; s#^git@github.com:##; s#\.git$##')
fi
GH_REPO="$REPO_REF"
[[ "$GH_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "invalid GitHub repository" >&2; exit 2; }

echo "→ validating '$SLUG'"
[[ "$SLUG" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] \
  || { echo "✗ slug must be lowercase letters, digits and hyphens, not starting or ending with one" >&2; exit 1; }

# Adopt main's register when every local row is already on main: the durable
# checkout is then a stale copy, not a holder of unpublished rows. If it does
# hold rows main lacks (a register PR still open), leave it — the allocation
# below reads both registers anyway.
FC_GIT="$(dirname "$(dirname "$(dirname "$MANIFEST")")")"
if [ "$DRY" != 1 ] && git -C "$FC_GIT" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
   && git -C "$FC_GIT" fetch -q origin main 2>/dev/null; then
  # Keyed on the slug, not the full row: main edits plan/price columns of
  # existing rows, and a row-for-row comparison then reported "unpublished"
  # forever, so the durable checkout never followed main (2026-09-11).
  unpublished=$(comm -23 <(grep -v '^#' "$MANIFEST" | grep . | cut -d'|' -f1 | sort) \
                         <(git -C "$FC_GIT" show origin/main:scripts/hetzner/apps.conf 2>/dev/null | grep -v '^#' | grep . | cut -d'|' -f1 | sort))
  if [ -z "$unpublished" ]; then
    git -C "$FC_GIT" checkout -q -- scripts/hetzner/apps.conf 2>/dev/null || true
    if git -C "$FC_GIT" merge -q --ff-only origin/main 2>/dev/null; then
      say "durable register fast-forwarded to origin/main ($(git -C "$FC_GIT" rev-parse --short HEAD))"
    else
      say "durable register not fast-forwarded (local changes beyond the register) — allocating against both registers"
    fi
  else
    say "durable register holds $(printf '%s\n' "$unpublished" | grep -c .) row(s) not yet on main — keeping it"
  fi
fi

ALREADY=0
EXISTING_LINE=""
if EXISTING_LINE=$(grep "^$SLUG|" "$MANIFEST" 2>/dev/null); then
  # Idempotent: Register site / kickoff retry after apps.conf was written earlier.
  existing_dir=$(printf '%s' "$EXISTING_LINE" | cut -d'|' -f4)
  existing_base=$(basename "$existing_dir")
  repo_name="${GH_REPO##*/}"
  if [ "$existing_base" != "$SLUG" ] && [ "$existing_base" != "$repo_name" ]; then
    echo "✗ '$SLUG' already in scripts/hetzner/apps.conf but repo path '$existing_dir' is incompatible with --repo $GH_REPO" >&2
    exit 1
  fi
  ALREADY=1
  REPO_DIR="$existing_dir"
  PORT=$(printf '%s' "$EXISTING_LINE" | cut -d'|' -f2)
  say "'$SLUG' already in scripts/hetzner/apps.conf — re-ensuring deploy.yml, secret, sync-infra"
else
  if cat $(registers) | grep -v '^#' | cut -d'|' -f3 | tr ',' '\n' | grep -qx "$SLUG.$BASE_DOMAIN"; then
    echo "✗ $SLUG.$BASE_DOMAIN is already served by another entry" >&2; exit 1
  fi
  if grep -q "^$SLUG|" "$RELEASE_MANIFEST" 2>/dev/null; then
    echo "✗ '$SLUG' is registered on main but not in the durable register at $MANIFEST — pull it before registering" >&2; exit 1
  fi
  for reserved in www api app admin support security billing pay wallet login auth account \
                  mail smtp imap ns1 ns2 mx cdn static assets vpn db status staging dev test \
                  preview bridge loki orangecat supabase solon evig revampit root system; do
    [ "$SLUG" = "$reserved" ] && { echo "✗ '$SLUG' is reserved (infrastructure or impersonation risk)" >&2; exit 1; }
  done
  REPO_DIR="$DEV_ROOT/$SLUG"
  PORT=$(cat $(registers) | grep -v '^#' | cut -d'|' -f2 | grep -E '^[0-9]+$' | sort -n | tail -1)
  PORT=$((PORT + 1))
  # The register does not know every service on the box. annushka's enquiry
  # API has listened on 4030 for days without a row, so probe-loop2 was handed
  # 4030, crash-looped on EADDRINUSE and every deploy rolled back
  # (2026-09-26). Skip any port something already listens on.
  # BOX_LISTENING_PORTS (space-separated) replaces the live read in tests.
  if [ -n "${BOX_LISTENING_PORTS+x}" ]; then
    in_use="$(printf '%s\n' $BOX_LISTENING_PORTS)"
  elif [ "$DRY" != 1 ]; then
    in_use="$(box "ss -Htln" 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -un)"
  else
    in_use=""
  fi
  while [ -n "$in_use" ] && grep -qx "$PORT" <<<"$in_use"; do
    say "port $PORT is already in use on the box (a service outside the register) — skipping it"
    PORT=$((PORT + 1))
  done
fi
say "port $PORT$([ "$ALREADY" = 1 ] && echo ' (existing)' || echo ' (next free after the highest in either register)')"
say "host $SLUG.$BASE_DOMAIN"
say "repo $GH_REPO  ->  $REPO_DIR"
say "manifest $MANIFEST"

# ----------------------------------------------------------------- checkout
echo "→ checkout"
# canonical_repo <owner/name>: the name GitHub resolves it to today. A repo
# transferred to another owner keeps answering under its old name, and the
# checkout's remote may carry either — comparing the two as strings called a
# legitimate checkout "another repository" after kaffeeklappe-sep11 moved
# from catomean to bitbaum (2026-09-11). Falls back to the input when offline.
canonical_repo() {
  local n
  n=$(env -u GH_TOKEN -u GITHUB_TOKEN gh api "repos/$1" --jq .full_name 2>/dev/null \
      || gh api "repos/$1" --jq .full_name 2>/dev/null || true)
  printf '%s' "${n:-$1}"
}
if [ -e "$REPO_DIR" ]; then
  actual_repo=$(git -C "$REPO_DIR" remote get-url origin | sed -E 's#^https://([^@/]+@)?github.com/##; s#^git@github.com:##; s#\.git$##')
  if [ "$actual_repo" != "$GH_REPO" ] && [ "$(canonical_repo "$actual_repo")" != "$(canonical_repo "$GH_REPO")" ]; then
    echo "ERROR: existing checkout belongs to another repository ($actual_repo, expected $GH_REPO)" >&2; exit 1
  fi
  say "exists $REPO_DIR — leaving contents alone"
else
  run "gh repo clone '$GH_REPO' '$REPO_DIR'"
fi

# ------------------------------------------------------------- runtime env
# Before the shim: pushing deploy.yml to main starts the site's first Deploy
# at once, and that job pulls /opt/<slug>/shared/.env from the box. Written
# after sync-infra, the env did not exist yet and velokiosk-sep10's first
# Deploy failed on "no runtime .env found" (2026-09-10). Never overwrites an
# existing environment.
echo "→ runtime env"
if [ "$DRY" = 1 ]; then
  say "DRY  would ensure /opt/$SLUG/shared/.env (NODE_ENV=production, PORT=$PORT)"
else
  box "sudo mkdir -p /opt/$SLUG/shared && sudo chown -R ubuntu:ubuntu /opt/$SLUG
    if [ ! -f /opt/$SLUG/shared/.env ]; then
      if [ -f /opt/$SLUG/app/.env ]; then cp -p /opt/$SLUG/app/.env /opt/$SLUG/shared/.env
      else (umask 077; printf 'NODE_ENV=production\nPORT=$PORT\n' > /opt/$SLUG/shared/.env); fi
    fi"
  say "/opt/$SLUG/shared/.env present"
fi

# --------------------------------------------------------------- workflows
# deploy.yml (the CD shim), ci.yml and auto-merge.yml (from site-template) are
# written to the remote through the GitHub Contents API, never through the
# clone. The clone under DEV_ROOT is the box agent's WORKSPACE: on 2026-09-11
# this step committed auto-merge.yml onto the agent's feature branch there and
# then failed to push it. The remote is the only state that matters here.
# Identity: this host's gh login first (it has the `workflow` scope the
# studio needs), the caller's token second.
echo "→ workflows"
WF_TMP="$(mktemp -d)"
trap 'rm -rf "$WF_TMP"' EXIT
write_deploy_yml() {
  cat > "$WF_TMP/deploy.yml" <<YML
name: Deploy

on:
  workflow_dispatch: {}
  push:
    branches: [main]

# The shared deploy refuses a commit whose CI is red by reading this commit's
# workflow runs. On a PRIVATE repo the org's default token cannot read Actions,
# so the gate saw "API unreachable" and passed every deploy (2026-09-26).
permissions:
  contents: read
  actions: read

jobs:
  deploy:
    uses: ${WORKFLOW_OWNER}/loki/.github/workflows/selfhost-deploy.yml@main
    with:
      app: ${SLUG}
    secrets:
      HETZNER_SSH_PRIVATE_KEY: \${{ secrets.HETZNER_SSH_PRIVATE_KEY }}
YML
}
# The release under /opt carries scripts/site-template without its .github
# directory; the durable checkout follows main and has the files.
SITE_TEMPLATE_WF="$HERE/../site-template/.github/workflows"
[ -d "$FC_REPO/scripts/site-template/.github/workflows" ] && SITE_TEMPLATE_WF="$FC_REPO/scripts/site-template/.github/workflows"
write_sidecar_workflows() {
  local f
  for f in ci.yml auto-merge.yml; do
    [ -f "$SITE_TEMPLATE_WF/$f" ] || { say "⚠ site-template has no $f — skipping"; continue; }
    sed "s|__SLUG__|$SLUG|g; s|__WORKFLOW_OWNER__|$WORKFLOW_OWNER|g" "$SITE_TEMPLATE_WF/$f" > "$WF_TMP/$f"
  done
}
gh_host() { env -u GH_TOKEN -u GITHUB_TOKEN gh "$@"; }
remote_workflow_sha() {
  gh_host api "repos/$GH_REPO/contents/.github/workflows/$1" --jq .sha 2>/dev/null \
    || gh api "repos/$GH_REPO/contents/.github/workflows/$1" --jq .sha 2>/dev/null
}
remote_workflow_body() {
  gh_host api "repos/$GH_REPO/contents/.github/workflows/$1" --jq .content 2>/dev/null | base64 -d 2>/dev/null
}
workflow_on_remote() { remote_workflow_sha "$1" >/dev/null; }
shim_on_remote() { workflow_on_remote deploy.yml; }
put_workflow() {
  local f="$1" msg="$2" sha ident
  sha=$(remote_workflow_sha "$f" || true)
  for ident in host caller; do
    if [ "$ident" = host ]; then
      gh_host api -X PUT "repos/$GH_REPO/contents/.github/workflows/$f" -f message="$msg" -f branch=main \
        -f content="$(base64 -w0 < "$WF_TMP/$f")" ${sha:+-f sha="$sha"} >/dev/null 2>&1 && { say "$f written ($ident gh login)"; return 0; }
    else
      gh api -X PUT "repos/$GH_REPO/contents/.github/workflows/$f" -f message="$msg" -f branch=main \
        -f content="$(base64 -w0 < "$WF_TMP/$f")" ${sha:+-f sha="$sha"} >/dev/null 2>&1 && { say "$f written ($ident token)"; return 0; }
    fi
  done
  say "⚠ $f could not be written to $GH_REPO by any identity here"
  return 1
}
write_deploy_yml
write_sidecar_workflows
if [ "$DRY" = 1 ]; then
  say "DRY  would write deploy.yml, ci.yml and auto-merge.yml (from site-template) to $GH_REPO via the Contents API"
else
  if ! workflow_on_remote deploy.yml; then
    put_workflow deploy.yml "chore: add self-host deploy shim for $SLUG" || true
  elif remote_workflow_body deploy.yml | grep -q 'secrets: inherit'; then
    # Cross-owner callers (e.g. catomean/* → bitbaum/loki) cannot inherit.
    put_workflow deploy.yml "fix: pass HETZNER_SSH_PRIVATE_KEY explicitly for cross-owner deploy" || true
  else
    say "deploy.yml already on the remote"
  fi
  shim_on_remote || { echo "ERROR: deploy.yml is not on $GH_REPO — no identity available here may write workflows" >&2; exit 1; }
  # A sidecar already on the remote is refreshed when the template moved on:
  # the site-template is the one copy of "how a site verifies and ships", and
  # a site registered last week must not keep last week's CI forever.
  for f in ci.yml auto-merge.yml; do
    [ -f "$WF_TMP/$f" ] || continue
    if ! workflow_on_remote "$f"; then
      put_workflow "$f" "ci: verify and auto-merge (seeded by Loki register)" \
        || say "⚠ $f is not on $GH_REPO — agent PRs on this site will wait for a human merge"
    elif ! remote_workflow_body "$f" | cmp -s - "$WF_TMP/$f"; then
      put_workflow "$f" "ci: refresh $f from the Loki site-template" || say "⚠ $f on $GH_REPO is stale and could not be refreshed"
    else
      say "$f already on the remote"
    fi
  done
fi

# ----------------------------------------------------------------- ci secret
echo "→ ci secret"
if [ "$DRY" = 1 ]; then
  say "DRY  gh secret set HETZNER_SSH_PRIVATE_KEY --repo $GH_REPO < $DEPLOY_KEY_PATH"
elif [ ! -r "$DEPLOY_KEY_PATH" ]; then
  SECRET_OK=0
  say "no key at $DEPLOY_KEY_PATH — CD will not reach the box."
elif gh secret set HETZNER_SSH_PRIVATE_KEY --repo "$GH_REPO" < "$DEPLOY_KEY_PATH" 2>/dev/null; then
  SECRET_OK=1
  say "HETZNER_SSH_PRIVATE_KEY set on $GH_REPO"
else
  SECRET_OK=0
  say "could not set the secret (gh auth?) — CD will not reach the box until it is set."
fi

[ "$DRY" = 1 ] || [ "$SECRET_OK" = 1 ] || { echo "ERROR: deploy secret was not installed" >&2; exit 1; }

# ------------------------------------------------------------- ci variable
# The deploy also needs HETZNER_IP. It exists as an ORG variable, and on the
# org's Free plan GitHub gives org secrets and variables to PUBLIC repos only.
# Loki provisions repos private by default, so a private site got the key
# above but no address: Farmhouse (2026-09-26) failed every Deploy with "org
# variable HETZNER_IP is unset". Setting it on the repo works for both
# visibilities. The value is the box address from _box-env.sh, not a secret.
echo "→ ci variable"
if [ "$DRY" = 1 ]; then
  say "DRY  gh variable set HETZNER_IP --repo $GH_REPO --body $HETZNER_IP"
elif gh variable set HETZNER_IP --repo "$GH_REPO" --body "$HETZNER_IP" 2>/dev/null; then
  say "HETZNER_IP set on $GH_REPO"
else
  echo "ERROR: could not set HETZNER_IP on $GH_REPO — a private repo cannot see the org variable, so its Deploy would fail" >&2
  exit 1
fi

# ------------------------------------------------------------------- register
echo "→ register"
if [ "$ALREADY" = 1 ]; then
  say "apps.conf row already present — not appending"
elif [ "$DRY" = 1 ]; then
  LINE="$SLUG|$PORT|$SLUG.$BASE_DOMAIN|$REPO_DIR|.|-|$OWNER|$KIND|$STATUS|$PLAN|$PRICE|$(date -u +%Y-%m-%d)"
  say "DRY  append: $LINE"
else
  LINE="$SLUG|$PORT|$SLUG.$BASE_DOMAIN|$REPO_DIR|.|-|$OWNER|$KIND|$STATUS|$PLAN|$PRICE|$(date -u +%Y-%m-%d)"
  printf '%s\n' "$LINE" >> "$MANIFEST"
  say "appended to $MANIFEST"
  publish_register_row "$LINE"
fi

# ------------------------------------------------------------------------ box
echo "→ box (systemd unit, launch.sh, Caddy vhost, monitoring)"
run "bash '$SYNC_INFRA' '$SLUG'"

# --------------------------------------------------------------------- deploy
if [ "$DEPLOY" = 1 ]; then
  echo "→ deploy"
  run "bash '$DEPLOY_SH' '$SLUG'"
fi

# ----------------------------------------------------------------------- next
if   [ "$DRY" = 1 ];      then SECRET_OK_LABEL="would be set from $DEPLOY_KEY_PATH"
elif [ "$SECRET_OK" = 1 ]; then SECRET_OK_LABEL="set — push deploys"
else                            SECRET_OK_LABEL="NOT set — CD cannot reach the box"; fi
STATUS_LABEL="registered for CD"
REGISTER_NOTE="$SLUG|$PORT|... in scripts/hetzner/apps.conf"
if [ "$ALREADY" = 1 ]; then
  STATUS_LABEL="already registered for CD"
  REGISTER_NOTE="$REGISTER_NOTE (existing)"
fi
cat <<NEXT

✓ $TITLE $STATUS_LABEL

  live      https://$SLUG.$BASE_DOMAIN
  repo      https://github.com/$GH_REPO
  register  $REGISTER_NOTE

  ci        deploy key ${SECRET_OK_LABEL}

NEXT
if [ "$ALREADY" != 1 ]; then
  cat <<NEXT
  Still yours to do:

  1. Commit the register change in the loki checkout:
       cd $(dirname "$MANIFEST")/../.. && git add scripts/hetzner/apps.conf && git commit

  2. If first deploy failed, fix the app until \`next build\` works, then push main (or workflow_dispatch Deploy).
NEXT
else
  cat <<NEXT
  Still yours to do:

  1. If the hostname 502s, run deploy.sh for this slug (or workflow_dispatch Deploy) once CI is green.
NEXT
fi
