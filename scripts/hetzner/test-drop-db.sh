#!/usr/bin/env bash
# Tests for droppable-db.sh, the register gate in front of
# .github/workflows/drop-db.yml, for drop-db-on-box.sh's refusals that do not
# need Postgres, and for that workflow's wiring.
#
# What must hold:
#   - a database no row names or uses is accepted, by name only;
#   - a system database, a name with a row (as itself or with '_' → '-'), a
#     name any row's db column uses, and a non-identifier are refused;
#   - the real register accepts the leftover signin database and refuses
#     morulia's (in use) and postgres;
#   - the workflow checks main's register and the confirmation before SSH,
#     the box's register after it, drops last, and never interpolates an
#     input into a script; an empty confirm is a dry run.
#
# Run: bash scripts/hetzner/test-drop-db.sh
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
morulia|4041|morulia.orangecat.ch|/x/morulia|.|morulia|bitbaum|infra|live|-|-|-
my-app|4040|my-app.orangecat.ch|/x/my-app|.|-|bitbaum|product|demo|-|-|-
revamp-info|4042|revamp-info.orangecat.ch|/x/ri|.|hirnli|bitbaum|product|live|-|-|-
gone|4044|gone.orangecat.ch|/x/gone|.|gone|bitbaum|product|archived|-|-|-
EOF

gate() { MANIFEST="$M" bash "$HERE/droppable-db.sh" "$@" 2>/dev/null; }

[ "$(gate signin)" = signin ] && ok "a database no row names or uses is accepted, by name" || fail "signin refused"
for bad in morulia my_app hirnli gone revamp_info postgres template0 template1 'Signin' 'a;rm' 'my-app' ''; do
  if out="$(gate "$bad")"; then fail "'$bad' was accepted ($out)"; fi
done
ok "a row's name, a row's db column, an archived row, a system db and non-identifiers are refused"

MANIFEST="$M" bash "$HERE/droppable-db.sh" hirnli 2>"$TMP/err" >/dev/null
grep -q "db column of: revamp-info" "$TMP/err" && ok "a refusal names the row that uses the database" || fail "refusal reason: $(cat "$TMP/err")"

[ "$(bash "$HERE/droppable-db.sh" signin 2>/dev/null)" = signin ] \
  && ok "the real apps.conf accepts the leftover signin database" || fail "real register refuses signin"
! bash "$HERE/droppable-db.sh" morulia >/dev/null 2>&1 && ! bash "$HERE/droppable-db.sh" postgres >/dev/null 2>&1 \
  && ok "the real apps.conf refuses morulia (in use) and postgres (system)" || fail "real register accepts morulia or postgres"

B="$HERE/drop-db-on-box.sh"
! bash "$B" postgres 1 >/dev/null 2>&1 && ! bash "$B" 'x;y' 1 >/dev/null 2>&1 \
  && ok "the box script refuses a system or malformed name before touching Postgres" || fail "box script accepted a bad name"
grep -q 'drop role' "$B" && grep -q 'datistemplate' "$B" && grep -q 'pg_stat_activity' "$B" && grep -q 'DATABASE_URL' "$B" \
  && ok "the box script checks templates, env files and connections" || fail "box script checks"
grep -q 'query_to_xml' "$B" && grep -q 'row(s)' "$B" \
  && ok "the report counts the rows exactly, before anything is dropped" || fail "row count"
go_line=$(grep -n 'if \[ "$GO" != 1 \]' "$B" | head -1 | cut -d: -f1)
drop_line=$(grep -n 'drop database' "$B" | head -1 | cut -d: -f1)
[ "$(grep -c 'drop database' "$B")" = 1 ] && [ -n "$go_line" ] && [ "$go_line" -lt "$drop_line" ] \
  && ok "the one drop statement sits behind the go flag" || fail "drop not gated on go"

W="$ROOT/.github/workflows/drop-db.yml"
line() { grep -n -- "$1" "$W" | head -1 | cut -d: -f1; }
main_gate=$(line 'bash scripts/hetzner/droppable-db.sh "$DB_NAME"')
confirm=$(line '"$CONFIRM" = "$DB_NAME"')
ssh_line=$(line 'ssh-keyscan')
box_gate=$(line 'MANIFEST="$RUNNER_TEMP/box-apps.conf" bash scripts/hetzner/droppable-db.sh')
drop=$(line '< scripts/hetzner/drop-db-on-box.sh')
for v in "$main_gate" "$confirm" "$ssh_line" "$box_gate" "$drop"; do [ -n "$v" ] || fail "workflow is missing a step"; done
[ "$main_gate" -lt "$ssh_line" ] && [ "$confirm" -lt "$ssh_line" ] && [ "$ssh_line" -lt "$box_gate" ] && [ "$box_gate" -lt "$drop" ] \
  && ok "main's register and the confirmation before SSH, the box's register next, the drop last" || fail "workflow step order"
grep -q 'echo "GO=0"' "$W" && ! grep -q 'default: "true"' "$W" \
  && ok "an empty confirm is a dry run" || fail "dry-run default"
grep -q '^on:' "$W" && ! grep -qE '^\s+(push|schedule|pull_request):' "$W" \
  && ok "dispatch only" || fail "workflow has another trigger"
[ -z "$(grep -E '\$\{\{ *inputs\.' "$W" | grep -vE '^[[:space:]]*(- )?name:|^[[:space:]]*(DB_NAME|CONFIRM): \$\{\{ inputs\.(db|confirm) \}\}$')" ] \
  && ok "inputs reach shell only through env, never interpolated into a script" || fail "input interpolated into run:"

echo "drop-db: $PASSED passed"
