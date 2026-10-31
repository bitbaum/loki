#!/usr/bin/env bash
# Tests for provisionable-db.sh, the register gate in front of
# .github/workflows/provision-db.yml, and for that workflow's wiring.
#
# What must hold:
#   - only an app whose apps.conf db column is a host database, under the name
#     provision-db-on-box.sh derives from the slug, is accepted;
#   - '-', supabase:<schema>, a renamed database, an archived row, an unknown
#     app and a non-slug input are refused before anything touches the box;
#   - the workflow runs the gate before its SSH step, and the real register
#     accepts signin (the app this workflow was written for).
#
# Run: bash scripts/hetzner/test-provision-db.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }

M="$TMP/apps.conf"
cat > "$M" <<'EOF'
# name|port|domains|repo_path|app_dir|db|owner|kind|status|plan|price|since
signin|4038|signin.orangecat.ch|/x/signin|.|signin|bitbaum|infra|prospect|-|-|-
my-app|4040|my-app.orangecat.ch|/x/my-app|.|my_app|bitbaum|product|demo|-|-|-
nodb|4041|nodb.orangecat.ch|/x/nodb|.|-|bitbaum|product|demo|-|-|-
sb|4042|sb.orangecat.ch|/x/sb|.|supabase:sb|bitbaum|product|demo|-|-|-
renamed|4043|renamed.orangecat.ch|/x/renamed|.|other|bitbaum|product|live|-|-|-
gone|4044|gone.orangecat.ch|/x/gone|.|gone|bitbaum|product|archived|-|-|-
EOF

gate() { MANIFEST="$M" bash "$HERE/provisionable-db.sh" "$@" 2>/dev/null; }

[ "$(gate signin)" = signin ] && ok "a host database under the slug's own name is accepted" || fail "signin refused"
[ "$(gate my-app)" = my_app ] && ok "'-' in the slug maps to '_' in the database" || fail "my-app refused"
for bad in nodb sb renamed gone unknown 'Signin' 'a;rm' ''; do
  if out="$(gate "$bad")"; then fail "'$bad' was accepted ($out)"; fi
done
ok "'-', supabase:, a renamed db, archived, unknown and non-slug inputs are refused"

[ "$(bash "$HERE/provisionable-db.sh" signin 2>/dev/null)" = signin ] \
  && ok "the real apps.conf accepts signin" || fail "real register refuses signin"

W="$ROOT/.github/workflows/provision-db.yml"
gate_line=$(grep -n 'bash scripts/hetzner/provisionable-db.sh' "$W" | head -1 | cut -d: -f1)
ssh_line=$(grep -n 'ssh-keyscan' "$W" | head -1 | cut -d: -f1)
run_line=$(grep -n 'provision-db-on-box.sh "\$APP"' "$W" | head -1 | cut -d: -f1)
[ -n "$gate_line" ] && [ -n "$ssh_line" ] && [ -n "$run_line" ] && [ "$gate_line" -lt "$ssh_line" ] && [ "$ssh_line" -lt "$run_line" ] \
  && ok "the workflow checks the register before it sets up SSH, and provisions last" || fail "workflow step order"
grep -q '^  group: provision-db$' "$W" && grep -q 'cancel-in-progress: false' "$W" \
  && ok "one concurrency group for every app, never cancelled" || fail "concurrency group"
[ -z "$(grep -E '\$\{\{ *inputs\.' "$W" | grep -vE '^[[:space:]]*(- )?name:|^[[:space:]]*APP: \$\{\{ inputs\.app \}\}$')" ] \
  && ok "the input reaches shell only through env, never interpolated into a script" || fail "input interpolated into run:"

echo "provision-db: $PASSED passed"
