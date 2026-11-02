#!/usr/bin/env bash
# Tests for accounts-db.conf: the drift check (check-accounts-db.sh), the
# provision gate's reading of it (provisionable-db.sh), the layout split in
# apply-schema.sh and the second schema step in deploy.sh.
#
# Run: bash scripts/hetzner/test-accounts-db.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }

M="$TMP/apps.conf"
cat > "$M" <<'CONF'
# name|port|domains|repo_path|app_dir|db|owner|kind|status|plan|price|since
sb-app|4042|sb.orangecat.ch|/x/sb|.|supabase:sb_app|bitbaum|product|demo|-|-|-
plain|4043|plain.orangecat.ch|/x/plain|.|plain|bitbaum|product|live|-|-|-
other-sb|4044|o.orangecat.ch|/x/o|.|supabase:other_sb|bitbaum|product|demo|-|-|-
gone-sb|4045|g.orangecat.ch|/x/g|.|supabase:gone_sb|bitbaum|product|archived|-|-|-
CONF

check() { MANIFEST="$M" ACCOUNTS_DB_REGISTER="$1" bash "$HERE/check-accounts-db.sh" >/dev/null 2>&1; }
gate()  { MANIFEST="$M" ACCOUNTS_DB_REGISTER="$1" bash "$HERE/provisionable-db.sh" "$2" 2>/dev/null; }
reg()   { printf '%s\n' "$@" > "$TMP/reg"; printf '%s' "$TMP/reg"; }

check "$(reg 'sb-app|sb_app')" && ok "a supabase app with its slug-derived accounts database passes" || fail "valid row refused"
check "$(reg '# a comment' '' 'sb-app|sb_app')" && ok "comments and blank lines are ignored" || fail "comment refused"
check "$TMP/none" && ok "no register at all is no drift" || fail "missing register refused"
for row in 'unknown|unknown' 'plain|plain_accounts' 'sb-app|sbapp' 'gone-sb|gone_sb' 'sb-app|sb_app|x' 'other-sb|plain'; do
  if check "$(reg "$row")"; then fail "drifted row accepted: $row"; fi
done
ok "an unknown, host-db, misnamed, archived, three-field or colliding row fails"
if check "$(reg 'sb-app|sb_app' 'sb-app|sb_app')"; then fail "duplicate accepted"; fi
ok "an app listed twice fails"

[ "$(gate "$(reg 'sb-app|sb_app')" sb-app)" = sb_app ] && ok "provision gate: a supabase app with a row gets its accounts database" || fail "gate refused sb-app"
if out="$(gate "$(reg 'sb-app|sb_app')" other-sb)"; then fail "gate accepted other-sb without a row ($out)"; fi
ok "provision gate: a supabase app without a row is still refused"
[ "$(gate "$(reg 'sb-app|sb_app')" plain)" = plain ] && ok "provision gate: host-database apps are unchanged" || fail "plain changed"

bash "$HERE/check-accounts-db.sh" >/dev/null 2>&1 && ok "the real accounts-db.conf agrees with the real apps.conf" || fail "real register drift"
[ "$(bash "$HERE/provisionable-db.sh" printcraft 2>/dev/null)" = printcraft ] && ok "the real register provisions printcraft's accounts database" || fail "printcraft not provisionable"

# apply-schema: a supabase-declared app never takes drizzle/, and ONLY_LAYOUT is honoured.
A="$HERE/apply-schema.sh"
grep -q '\[ -n "${DECLARED_SUPABASE:-}" \] && ONLY_LAYOUT=supabase' "$A" && ok "apply-schema: a supabase schema only ever takes supabase/migrations" || fail "supabase layout lock"
grep -q 'if \[ "\$ONLY_LAYOUT" != supabase \]; then' "$A" && grep -q '\[ "\$ONLY_LAYOUT" != drizzle \]; then' "$A" \
  && ok "apply-schema: ONLY_LAYOUT skips the other layout's probe" || fail "ONLY_LAYOUT probes"

# deploy.sh: the accounts step runs after the schema step, drizzle only, and aborts on failure.
D="$HERE/deploy.sh"
schema_line=$(grep -n '"\$HERE/apply-schema.sh" "\$NAME" "\$REPO" "\$DB"' "$D" | head -1 | cut -d: -f1)
acct_line=$(grep -n 'ONLY_LAYOUT=drizzle "\$HERE/apply-schema.sh" "\$NAME" "\$REPO" "\$ACCOUNTS_DB"' "$D" | head -1 | cut -d: -f1)
build_line=$(grep -n 'run build' "$D" | head -1 | cut -d: -f1)
[ -n "$schema_line" ] && [ -n "$acct_line" ] && [ "$schema_line" -lt "$acct_line" ] && [ "$acct_line" -lt "$build_line" ] \
  && ok "deploy.sh applies the accounts database after the schema and before the build" || fail "deploy.sh order"

# accountkit-supabase.sh refuses before it touches the box.
touch "$TMP/p.sql" "$TMP/i.sql"
imp() { MANIFEST="$M" ACCOUNTS_DB_REGISTER="$(reg 'sb-app|sb_app')" HETZNER_IP=192.0.2.1 bash "$HERE/accountkit-supabase.sh" "$@" >/dev/null 2>&1; }
if imp plain survey "$TMP/p.sql" "$TMP/i.sql"; then fail "import ran for a host-database app"; fi
if imp other-sb survey "$TMP/p.sql" "$TMP/i.sql"; then fail "import ran without an accounts database"; fi
if imp sb-app wipe "$TMP/p.sql" "$TMP/i.sql"; then fail "an unknown action ran"; fi
if imp sb-app survey "$TMP/none.sql" "$TMP/i.sql"; then fail "a missing SQL file ran"; fi
ok "the import refuses a host-db app, an app with no accounts database, an unknown action and a missing file"
! grep -qiE '\b(truncate|drop table|delete from)\b' "$HERE/accountkit-supabase.sh" \
  && ok "the import script has no path that empties a table" || fail "accountkit-supabase.sh can empty a table"

echo "accounts-db: $PASSED passed"
