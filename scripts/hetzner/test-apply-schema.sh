#!/usr/bin/env bash
#
# Tests for which SCHEMA an app's migrations land in.
#
# This is the question that broke botsmann. One supabase database backs several
# apps: orangecat owns `public` and its 128 tables, printcraft has its own
# schema, botsmann had none. The manifest's db field said '-', which deploy.sh
# reads as "no database" and skips the schema step entirely — so eleven
# migrations sat unapplied for months while every deploy went green and
# /api/health returned 503 from a table that did not exist.
#
# The fix has two halves and both are pinned here:
#
#   1. `-` must keep meaning "skip" for the apps that genuinely have no DB, so
#      the fix cannot start provisioning schemas for camille or substrata.
#   2. A supabase app declares `supabase:<schema>` and its migrations must land
#      THERE, never in public — because landing in public is not merely untidy.
#      botsmann's 001 defines `CREATE OR REPLACE FUNCTION update_updated_at()`,
#      a name public already holds, so the apply would have silently redefined
#      the function orangecat's triggers call. A test that only checked table
#      names would have missed that.
#
# Pure: no box, no database, no checkout.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/apply-schema.sh"
MANIFEST="$HERE/apps.conf"

PASS=0; FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }

export APPLY_SCHEMA_LIB_ONLY=1
# shellcheck source=/dev/null
source "$SCRIPT" testapp /nonexistent - .
unset APPLY_SCHEMA_LIB_ONLY

# eq <expected> <actual> <label>
eq() { [ "$1" = "$2" ] && ok "$3" || no "$3 (want '$1', got '$2')"; }

# rejects <db> <label> — schema_from_db must fail, not silently pick a schema
rejects() {
  local out
  if out=$(schema_from_db "$1" 2>/dev/null); then
    no "$2 — accepted it and returned '$out'"
  else
    ok "$2"
  fi
}

echo "schema_from_db — which schema does this app own?"
eq public   "$(schema_from_db -)"                  "'-' stays public (and deploy.sh skips it entirely)"
eq public   "$(schema_from_db kivvi)"              "a host database name is unchanged"
eq public   "$(schema_from_db aoz_wohnen)"         "underscores in a host db name are not a schema"
eq botsmann "$(schema_from_db supabase:botsmann)"  "supabase:botsmann -> botsmann"
eq acme_co  "$(schema_from_db supabase:acme_co)"   "underscores are allowed in a schema name"

echo
echo "schema_from_db — refuses rather than guesses"
rejects "supabase:"            "'supabase:' with no schema name"
rejects "supabase:public"      "'supabase:public' would put a second app in orangecat's schema"
rejects "supabase:pg_temp"     "a pg_-prefixed schema is reserved by Postgres"
rejects "supabase:Botsmann"    "uppercase would need quoting everywhere it is interpolated"
rejects "supabase:bots;drop"   "a semicolon is interpolated straight into SQL"
rejects "supabase:a b"         "a space is interpolated straight into SQL"

echo
echo "ledger_for — each app's ledger sits beside its own tables"
eq "public._deploy_schema_history"   "$(ledger_for public)"   "public keeps the ledger it already has"
eq "botsmann._deploy_schema_history" "$(ledger_for botsmann)" "botsmann gets its own"
[ "$(ledger_for botsmann)" != "$(ledger_for public)" ] \
  && ok "two apps never share one ledger (shared tags make 'up to date' meaningless)" \
  || no "two apps share a ledger"

echo
echo "the script itself"
grep -q 'SET LOCAL search_path TO \$TARGET_SCHEMA' "$SCRIPT" \
  && ok "the batch sets search_path — this is what keeps CREATE TABLE out of public" \
  || no "the batch never sets search_path, so unqualified DDL lands in public"
grep -q 'ALTER DEFAULT PRIVILEGES IN SCHEMA \$TARGET_SCHEMA' "$SCRIPT" \
  && ok "default privileges are granted before the tables exist" \
  || no "only existing tables are granted, so migrations create unreachable tables"
grep -q "table_schema='\$TARGET_SCHEMA'" "$SCRIPT" \
  && ok "the baseline guard counts the app's OWN tables" \
  || no "the baseline guard counts public, where another app's 128 tables hide an empty schema"
! grep -qE "INSERT INTO public\._deploy_schema_history|FROM public\._deploy_schema_history" "$SCRIPT" \
  && ok "no ledger reference is hardcoded to public" \
  || no "a hardcoded public ledger reference survives"

echo
echo "the destructive guard — a statement, not a substring"
DESTRUCTIVE='DROP TABLE|DROP COLUMN|DROP SCHEMA|TRUNCATE|DELETE[[:space:]]+FROM|ALTER COLUMN[[:space:]].*[[:space:]]TYPE[[:space:]]'
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# blocks <label> <sql...> — the guard must find something
blocks() {
  local label="$1"; shift
  printf '%b' "$*" > "$TMP/m.sql"
  if strip_bodies "$TMP/m.sql" | grep -qiE "$DESTRUCTIVE"; then ok "$label"; else no "$label"; fi
}
# allows <label> <sql...> — the guard must find nothing
allows() {
  local label="$1"; shift
  printf '%b' "$*" > "$TMP/m.sql"
  if strip_bodies "$TMP/m.sql" | grep -qiE "$DESTRUCTIVE"; then no "$label"; else ok "$label"; fi
}

blocks "a bare DROP TABLE still blocks the deploy" \
  'CREATE TABLE a(id int);\nDROP TABLE legacy_users;\n'
blocks "a DROP COLUMN still blocks" \
  'ALTER TABLE a DROP COLUMN b;\n'
blocks "a real DELETE FROM at statement level still blocks" \
  'DELETE FROM users WHERE id = 1;\n'

allows "DELETE FROM inside a function body does NOT block (this aborted botsmann's deploy)" \
  'CREATE OR REPLACE FUNCTION cleanup_rate_limits() RETURNS INTEGER AS $$\nBEGIN\n  DELETE FROM rate_limits WHERE window_start < now();\n  RETURN 1;\nEND;\n$$ LANGUAGE plpgsql;\n'
allows "a tagged dollar-quote is handled too" \
  'CREATE FUNCTION f() RETURNS void AS $body$\nBEGIN\n  TRUNCATE t;\nEND;\n$body$ LANGUAGE plpgsql;\n'
blocks "the guard resumes after the body closes" \
  'CREATE FUNCTION f() RETURNS void AS $$\nBEGIN\n  DELETE FROM inner_only;\nEND;\n$$ LANGUAGE plpgsql;\nDROP TABLE after_body;\n'
allows "additive DDL is never destructive" \
  'CREATE TABLE IF NOT EXISTS a(id uuid PRIMARY KEY);\nCREATE INDEX i ON a(id);\n'

# The real thing: every botsmann migration must pass, or the deploy aborts.
BOTS="${BOTSMANN_REPO:-$HOME/dev/botsmann}/supabase/migrations"
if [ -d "$BOTS" ]; then
  hits=0
  for f in "$BOTS"/[0-9]*.sql; do
    strip_bodies "$f" | grep -qiE "$DESTRUCTIVE" && { hits=$((hits+1)); echo "      $(basename "$f")"; }
  done
  [ "$hits" -eq 0 ] \
    && ok "all of botsmann's real migrations pass the guard" \
    || no "$hits botsmann migration(s) would abort the deploy"
else
  echo "  · botsmann checkout not present — skipping the real-migration check"
fi

echo
echo "apps.conf — every declared schema is one the script accepts"
while IFS='|' read -r name _ _ _ _ db _; do
  case "$name" in ''|\#*) continue;; esac
  case "$db" in
    supabase:*)
      if schema_from_db "$db" >/dev/null 2>&1; then
        ok "$name declares a valid schema ($db)"
      else
        no "$name declares '$db', which apply-schema.sh refuses"
      fi
      ;;
  esac
done < "$MANIFEST"

botsmann_db=$(grep '^botsmann|' "$MANIFEST" | cut -d'|' -f6)
eq "supabase:botsmann" "$botsmann_db" "botsmann is wired to a schema (it was '-', which skipped the step)"

echo
echo
echo "migration_dirs — ONE list, shared with the deploy-ready gate"
# The gate fails a build when an app ships migrations while declaring db=-.
# It must look exactly where the applier looks, or it starts lying in the other
# direction: passing an app whose migrations sit in a directory it never checks.
eq "/r/packages/database/drizzle
/r/app/drizzle
/r/app/src/lib/db/migrations
/r/drizzle
/r/src/lib/db/migrations" "$(migration_dirs drizzle /r app)" "drizzle candidates, in the applier's own order"
eq "/r/app/supabase/migrations
/r/supabase/migrations" "$(migration_dirs supabase /r app)" "supabase candidates — app_dir first, then repo root"
eq "/r/app/prisma/migrations" "$(migration_dirs prisma /r app)" "prisma has exactly one home"
eq "/r/./drizzle" "$(migration_dirs drizzle /r . | sed -n 2p)" "an app_dir of '.' still yields a usable path"
migration_dirs nonsense /r . >/dev/null 2>&1 \
  && no "an unknown layout must fail, not silently return nothing" \
  || ok "an unknown layout fails loudly rather than reporting no migrations"


# ── The app's role can use the tables its migrations create ─────────────────
# skif, 2026-09-25: "schema applied ✓", 14 tables, and the app's own role could
# read none of them, because migrations run as postgres. heidi only worked via
# default privileges someone set by hand; kivvi still cannot read five tables.
g=$(app_role_default_privileges_sql skif public)
for want in \
  "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skif;" \
  "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO skif;" \
  "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO skif;"; do
  grep -qxF "$want" <<<"$g" && ok "defaults: $want" || no "defaults missing: $want"
done

# NEVER re-grant existing tables. kivvi's immutable-books spec plans to REVOKE
# UPDATE, DELETE on its append-only audit log; a GRANT on ALL TABLES every
# deploy would silently undo that each time. Defaults touch only NEW tables,
# so a migration's own REVOKE (which runs after its CREATE) still wins.
grep -q "ON ALL TABLES" <<<"$g" \
  && no "the access step re-grants EXISTING tables — it would undo a deliberate REVOKE on every deploy" \
  || ok "existing tables are never re-granted, so a deliberate REVOKE survives deploys"
grep -qE "GRANT ALL( |$)" <<<"$g" \
  && no "the default grant is ALL — TRUNCATE, REFERENCES and TRIGGER are not the app's by default" \
  || ok "the default grant is plain DML, not ALL"

# The defaults must be set BEFORE the migration batch: they only cover tables
# created after they exist, so setting them afterwards would leave every table
# of a brand-new app's first deploy unreadable — the exact skif case.
defaults_at=$(grep -n '^set_app_role_defaults || exit 1$' "$SCRIPT" | cut -d: -f1)
batch_at=$(grep -n '^run_sql -q < "\$BATCH"$' "$SCRIPT" | cut -d: -f1)
report_at=$(grep -n '^ensure_app_role_access || exit 1$' "$SCRIPT" | cut -d: -f1)
{ [ -n "$defaults_at" ] && [ -n "$batch_at" ] && [ -n "$report_at" ] \
  && [ "$defaults_at" -lt "$batch_at" ] && [ "$batch_at" -lt "$report_at" ]; } \
  && ok "defaults are set before the migrations run, and access is checked after" \
  || no "defaults must be set BEFORE the batch (got defaults=$defaults_at batch=$batch_at report=$report_at)"

# The role and schema are interpolated into SQL, so anything that is not a
# plain identifier is refused rather than quoted.
for evil in "skif; DROP DATABASE loki" "Skif" "sk-if" "" "skif'--"; do
  app_role_default_privileges_sql "$evil" public >/dev/null 2>&1 \
    && no "defaults accepted a non-identifier role: '$evil'" \
    || ok "defaults refuse the role '$evil'"
done
app_role_default_privileges_sql skif "public; DROP SCHEMA public" >/dev/null 2>&1 \
  && no "defaults accepted a non-identifier schema" \
  || ok "defaults refuse a non-identifier schema"

q=$(app_role_unreadable_tables_sql skif public)
grep -qF "has_table_privilege('skif', c.oid, 'SELECT')" <<<"$q" \
  && ok "the check asks whether the APP role can read, not whether tables exist" \
  || no "the readability check does not test the app role's privilege"
grep -qF "c.relname <> '_deploy_schema_history'" <<<"$q" \
  && ok "the deploy's own ledger is not reported (the app never reads it)" \
  || no "the ledger table would be reported as unreadable on every app"
app_role_unreadable_tables_sql "skif'; --" public >/dev/null 2>&1 \
  && no "the check accepted a non-identifier role" \
  || ok "the check refuses a non-identifier role"


printf 'apply-schema: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
