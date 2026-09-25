#!/usr/bin/env bash
# Make `git push` deploy — push-to-deploy on our own box.
#
# Installs a pre-push hook into every repo in apps.conf (plus loki
# itself) that backgrounds the existing deploy pipeline (build standalone →
# rsync → restart → health check). The hook detaches and waits a few seconds
# so the actual push isn't slowed; the deploy builds the working tree you
# just pushed from. Logs land in /tmp/push-deploy-<app>.log.
#
# Idempotent: re-running updates the hook block in place (markers).
# Husky repos get the line in .husky/pre-push; plain repos in .git/hooks.
#
# Usage: install-push-deploy.sh [app ...]   (no args = all + loki)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MARK_BEGIN="# >>> loki push-deploy >>>"
MARK_END="# <<< loki push-deploy <<<"

install_hook() { # repo_path deploy_cmd app_name
  local repo="$1" deploy_cmd="$2" app="$3"
  local hook
  if [ -d "$repo/.husky" ]; then
    hook="$repo/.husky/pre-push"
    [ -f "$hook" ] || { echo "#!/usr/bin/env sh" > "$hook"; chmod +x "$hook"; }
  else
    [ -d "$repo/.git" ] || { echo "skip $app: no .git in $repo"; return; }
    hook="$repo/.git/hooks/pre-push"
    [ -f "$hook" ] || { echo "#!/usr/bin/env sh" > "$hook"; chmod +x "$hook"; }
  fi

  # Replace any previous block, then append the current one.
  local tmp
  tmp=$(mktemp)
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
    $0 == b { skip = 1; next }
    $0 == e { skip = 0; next }
    !skip { print }
  ' "$hook" > "$tmp" && mv "$tmp" "$hook"

  cat >> "$hook" <<EOF
$MARK_BEGIN
# Pushing the repo's default branch deploys to the Hetzner box
# (background; see /tmp/push-deploy-$app.log). Repos differ: some use
# 'main', some still use 'master' — match either so push-to-deploy fires
# regardless of the repo's branch convention.
# CI GATE: the background deploy first waits for GitHub CI on the pushed
# commit and is BLOCKED on a red — prod only receives what CI verified
# (ci-gate.sh; repos without CI pass after a short grace window).
if git symbolic-ref --short HEAD 2>/dev/null | grep -qxE 'main|master'; then
  ( sleep 5
    _sha=\$(git rev-parse HEAD)
    _nwo=\$(git remote get-url origin 2>/dev/null | sed -E 's#(git@github.com:|https://github.com/)##; s#\\.git\$##')
    if [ -n "\$_nwo" ] && ! bash "\${DEV_ROOT:-\$HOME/dev}/loki/scripts/hetzner/ci-gate.sh" "\$_nwo" "\$_sha"; then
      echo "[push-deploy] $app: BLOCKED by CI gate for \${_sha} — fix CI, then re-push or deploy manually"
    else
      $deploy_cmd
    fi
  ) >> /tmp/push-deploy-$app.log 2>&1 & disown 2>/dev/null || true
  echo "[push-deploy] $app: CI-gated deploy started in background → /tmp/push-deploy-$app.log"
fi
$MARK_END
EOF
  chmod +x "$hook"
  echo "installed: $app ($hook)"
}

# demo_shares_repo_with_app <name> <kind> <repo> — true when <name> is a demo
# whose repo_path another, non-demo row also uses. Pure over $MANIFEST.
demo_shares_repo_with_app() {
  [ "$2" = demo ] || return 1
  awk -F'|' -v n="$1" -v r="$3" '
    /^[[:space:]]*#/ || NF < 8 { next }
    $1 != n && $4 == r && $8 != "demo" { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$MANIFEST"
}

if [ -n "${PUSH_DEPLOY_LIB_ONLY:-}" ]; then return 0; fi

apps=("$@")
if [ ${#apps[@]} -eq 0 ]; then
  mapfile -t apps < <(app_names)
  apps+=(loki evig)
fi

for app in "${apps[@]}"; do
  # DEV_ROOT comes from _box-env.sh (via lib.sh, sourced above) — the checkout
  # root is one constant, not a laptop path repeated per special case.
  if [ "$app" = "loki" ]; then
    install_hook "$DEV_ROOT/loki" \
      "env -u CI bash $DEV_ROOT/loki/scripts/deploy-hetzner.sh" \
      loki
    continue
  fi
  if [ "$app" = "evig" ]; then
    install_hook "$DEV_ROOT/evig" \
      "env -u CI bash $DEV_ROOT/evig/scripts/selfhost-deploy-evig.sh" \
      evig
    continue
  fi
  app_lookup "$app" || continue
  # A demo that shares its repo with a real app never owns the push hook.
  # install_hook REPLACES the marked block, so the last row sharing a repo
  # wins: aoz-demo (appended after aoz-wohnen, same aoz-begleitung checkout)
  # would have made every push deploy the demo instead of the app. The demo
  # ships through its own gated job.
  if demo_shares_repo_with_app "$NAME" "$KIND" "$REPO"; then
    echo "skip $NAME: demo shares $REPO with a real app, which keeps the push hook"
    continue
  fi
  install_hook "$REPO" \
    "env -u CI bash \"\${DEV_ROOT:-\$HOME/dev}/loki/scripts/hetzner/deploy.sh\" $NAME" \
    "$NAME"
done
