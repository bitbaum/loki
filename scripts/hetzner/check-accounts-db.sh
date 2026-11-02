#!/usr/bin/env bash
# check-accounts-db.sh — accounts-db.conf must agree with apps.conf.
#
# A row there gives a supabase-schema app a host accounts database (see the
# file's header). A row that drifts from the register does damage quietly:
# a renamed app's accounts are provisioned under a name no deploy applies
# migrations to, and a row for a host-database app would hand deploy.sh a
# second drizzle apply against another database. So each row must:
#   - name an app in apps.conf that is not archived, once;
#   - be an app whose db column is `supabase:<schema>`;
#   - name the database provision-db-on-box.sh derives from the slug;
#   - not be a host database another apps.conf row already uses.
#
# Prints names only. Exit 1 on any drift.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

bad=0
drift() { echo "accounts-db drift: $*" >&2; bad=1; }
seen=" "
host_dbs=" $(grep -v '^#' "$MANIFEST" | awk -F'|' 'NF && $6 != "-" && $6 !~ /^supabase:/ { printf "%s ", $6 }')"

while IFS='|' read -r app database extra; do
  [ -n "$app" ] || continue
  [ -z "$extra" ] || { drift "$app: more than two fields"; continue; }
  case "$seen" in *" $app "*) drift "$app is listed twice"; continue ;; esac
  seen="$seen$app "
  if ! app_lookup "$app" 2>/dev/null; then drift "$app is not in apps.conf"; continue; fi
  [ "${STATUS:-}" != archived ] || drift "$app is archived in apps.conf"
  case "$DB" in supabase:*) ;; *) drift "$app's apps.conf db is '$DB', not a supabase schema; give it a host db there instead" ;; esac
  [ "$database" = "${app//-/_}" ] || drift "$app's accounts database is '$database', but provision-db-on-box.sh would create '${app//-/_}'"
  case "$host_dbs" in *" $database "*) drift "$app's accounts database '$database' is already another app's host database" ;; esac
done < <(grep -v '^#' "$ACCOUNTS_DB_REGISTER" | grep -v '^[[:space:]]*$' || true)

[ "$bad" = 0 ] || exit 1
echo "accounts-db.conf agrees with apps.conf ($(printf '%s' "$seen" | wc -w | tr -d ' ') row(s))"
