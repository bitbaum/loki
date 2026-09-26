#!/usr/bin/env bash
#
# Tests for a demo instance that shares its repo with a real app.
#
# aoz-demo (2026-09-25) is a no-account copy of aoz-wohnen, built from the same
# aoz-begleitung checkout. Two things must hold, and both fail silently:
#
#   1. The real app keeps the push-to-deploy hook. install_hook REPLACES the
#      marked block, so the last row sharing a repo wins: without a guard, the
#      demo (appended after aoz-wohnen) would make every push deploy the demo.
#   2. The nightly reset route truncates the database. It may only ever be
#      registered for a demo-kind app — never for the app real people use.
#
# Pure: no box, no ssh. The cron registry is read as text, never executed.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
no() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }

# ── 1. push hook ownership ───────────────────────────────────────────────────
MANIFEST="$(mktemp)"
cat > "$MANIFEST" <<'CONF'
# name|port|domains|repo_path|app_dir|db|owner|kind|status|plan|price|since
real|4008|real.example|/repo/shared|.|real|X|client-app|live|-|-|-
dem|4028|demo.example|/repo/shared|.|dem|bitbaum|demo|live|-|-|-
solo|4030|solo.example|/repo/solo|.|solo|bitbaum|demo|live|-|-|-
twin|4031|twin.example|/repo/twins|.|twin|bitbaum|demo|live|-|-|-
twin2|4032|twin2.example|/repo/twins|.|twin2|bitbaum|demo|live|-|-|-
CONF
export MANIFEST
# shellcheck source=install-push-deploy.sh
PUSH_DEPLOY_LIB_ONLY=1 . "$HERE/install-push-deploy.sh"

demo_shares_repo_with_app dem demo /repo/shared \
  && ok "a demo sharing a real app's repo does not take its push hook" \
  || no "the demo would replace the real app's push hook — every push deploys the demo"
demo_shares_repo_with_app real client-app /repo/shared \
  && no "the real app lost its own push hook" \
  || ok "the real app keeps its push hook"
demo_shares_repo_with_app solo demo /repo/solo \
  && no "a demo with its own repo was denied a push hook" \
  || ok "a demo with its own repo still gets one"
demo_shares_repo_with_app twin demo /repo/twins \
  && no "two demos sharing a repo were treated as a real app" \
  || ok "only a NON-demo row makes the repo belong to someone else"
rm -f "$MANIFEST"

grep -q 'demo_shares_repo_with_app "$NAME" "$KIND" "$REPO"' "$HERE/install-push-deploy.sh" \
  && ok "the install loop asks the guard before installing a hook" \
  || no "the install loop no longer checks demo_shares_repo_with_app"

# ── 2. the reset route only on a demo ────────────────────────────────────────
registry="$(awk '/^REGISTRY="\$\(cat <<.REG.$/{f=1;next} /^REG$/{f=0} f' "$HERE/install-app-crons.sh")"
[ -n "$registry" ] && ok "the app-cron registry was read" || no "could not read the app-cron registry"

reset_apps="$(grep -v '^#' <<<"$registry" | awk -F'|' '$4 ~ /reset-demo/ {print $1}')"
# None registered is fine: aoz-demo was retired 2026-09-26 (the demo moved back
# onto aoz.orangecat.ch). What must hold is that no NON-demo app carries it.
ok "reset-demo jobs read (${reset_apps:-none registered})"
# Production apps whose reset-demo route is SCOPED — it deletes only invented
# demo rows and never truncates. Each entry is a deliberate, reviewed decision
# naming where that scoping lives; the list is not a way to silence this gate.
#   aoz-wohnen — bitbaum/aoz-begleitung#272, resetDemoData(db, { scope: 'scoped' }),
#                gated on DEMO_ACCESS_ENABLED=true (George, 2026-09-26)
SCOPED_RESET_APPS="aoz-wohnen"
for app in $reset_apps; do
  kind="$(awk -F'|' -v n="$app" '!/^#/ && $1 == n {print $8}' "$HERE/apps.conf")"
  if [ "$kind" = demo ]; then
    ok "reset-demo on '$app' — kind demo in apps.conf"
  elif [[ " $SCOPED_RESET_APPS " == *" $app "* ]]; then
    ok "reset-demo on '$app' — a production app with a reviewed, scoped reset"
  else
    no "reset-demo registered on '$app' (kind '${kind:-missing}'): it could delete a real app's data"
  fi
done

printf 'demo-instance: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
