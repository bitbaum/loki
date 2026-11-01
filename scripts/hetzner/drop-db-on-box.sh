#!/usr/bin/env bash
# drop-db-on-box.sh <database> <go: 0|1> — ON THE BOX, as ubuntu: report on one
# host database and, with go=1, drop it and the login role of the same name.
#
# Sent over SSH on stdin by .github/workflows/drop-db.yml, after
# droppable-db.sh has accepted the name against main's register and the box's.
# This adds what only the box knows, and refuses on any of it:
#
#   - a system or template database (pg_database.datistemplate, or one of
#     postgres/template0/template1) — checked again here, not trusted;
#   - an env file under /opt/*/ whose DATABASE_URL names this database: an app
#     is configured to use it whatever the register says;
#   - an open connection to it.
#
# Prints names, counts and sizes only — never a value from an env file. This
# repo is public, so the run log is too.
#
# The role is dropped after the database only if Postgres agrees: DROP ROLE
# fails while the role owns anything or holds a grant anywhere else, and that
# failure is reported and leaves the role.
set -euo pipefail

DB="${1:-}"; GO="${2:-0}"
[[ "$DB" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || { echo "not a plain database name" >&2; exit 2; }
case "$DB" in postgres|template0|template1) echo "$DB is a system database; refusing" >&2; exit 1 ;; esac

# </dev/null: this script itself arrives on stdin, and must not be read by psql.
psql_su() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qtAX "$@" </dev/null; }

exists="$(psql_su -c "select datistemplate from pg_database where datname = '$DB'")"
if [ -z "$exists" ]; then
  echo "database $DB does not exist on this box; nothing to drop"
  exit 0
fi
[ "$exists" = f ] || { echo "$DB is a template database; refusing" >&2; exit 1; }

# Who is configured to use it. The pattern matches the database at the end of
# the URL's path (…/<db> or …/<db>?…); only the file's directory is printed.
users=""
while IFS= read -r f; do
  if sudo grep -qE "^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=[\"']?postgres(ql)?://[^[:space:]]*/$DB([?\"'[:space:]]|$)" "$f" 2>/dev/null; then
    users="$users $(dirname "$f")"
  fi
done < <(sudo find /opt -maxdepth 4 -name '.env*' -type f 2>/dev/null)
if [ -n "$users" ]; then
  echo "an env file names $DB in DATABASE_URL:$users — refusing" >&2
  exit 1
fi

conns="$(psql_su -c "select count(*) from pg_stat_activity where datname = '$DB'")"
size="$(psql_su -c "select pg_size_pretty(pg_database_size('$DB'))")"
owner="$(psql_su -c "select pg_get_userbyid(datdba) from pg_database where datname = '$DB'")"
tables="$(psql_su -d "$DB" -c "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')")"
# Exact, not pg_stat's estimate (zero until autovacuum has looked): "it holds
# no users" is a claim to check before an irreversible drop, not to take on
# trust. One count per table, summed; a count is not data.
rows="$(psql_su -d "$DB" -c "select coalesce(sum((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint), 0) from pg_tables where schemaname not in ('pg_catalog','information_schema')")"
role="$(psql_su -c "select 1 from pg_roles where rolname = '$DB'")"

echo "database $DB: owner $owner, $size, $tables table(s) holding $rows row(s), $conns open connection(s)"
[ -n "$role" ] && echo "role $DB exists (dropped after the database if it owns nothing else)" \
  || echo "no role named $DB"

[ "$conns" = 0 ] || { echo "$DB has open connections; refusing" >&2; exit 1; }

if [ "$GO" != 1 ]; then
  echo "DRY RUN — nothing was dropped. Dispatch again with confirm=$DB to drop it."
  exit 0
fi

psql_su -c "drop database \"$DB\""
echo "✓ dropped database $DB"
if [ -n "$role" ]; then
  if psql_su -c "drop role \"$DB\"" 2>/dev/null; then
    echo "✓ dropped role $DB"
  else
    echo "role $DB kept: Postgres refused to drop it (it owns or is granted something elsewhere)"
  fi
fi
# Left on purpose: a pg_hba.conf line for a role that no longer exists admits
# nobody, and editing that file is provision-db's job, not this one's.
echo "any pg_hba.conf line or ~/.db-credentials entry for $DB is left as it is"
