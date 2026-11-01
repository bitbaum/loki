#!/usr/bin/env bash
# droppable-db.sh <database> — print <database> if the register allows dropping
# it from the box's host Postgres, or refuse.
#
# The gate in front of .github/workflows/drop-db.yml, the one path that drops a
# host database. retire-site.sh never does (a site taken down keeps its data),
# so a renamed or retired service leaves its database behind — signin, renamed
# to morulia on 2026-11-01. Dropping is the one step here nobody can undo, so a
# name is accepted only when nothing in the register can still mean it:
#
#   - it is a plain identifier (what provision-db-on-box.sh creates);
#   - it is not a system database (postgres, template0, template1);
#   - no apps.conf row is named after it (`signin` or, for `my_app`, `my-app`):
#     a row is a site that may still be provisioned under that name;
#   - no row's `db` column names it — the database an app is using.
#
# The workflow runs this against main's register AND the box's checkout of it
# (where register-site.sh writes a new row first), and the box script then
# checks the box itself (env files, connections). Prints names only.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$HERE/lib.sh"

DB_NAME="${1:-}"
[[ "$DB_NAME" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || {
  echo "not a plain host database name: '$DB_NAME'" >&2; exit 2; }

case "$DB_NAME" in
  postgres|template0|template1)
    echo "$DB_NAME is a system database; refusing" >&2; exit 1 ;;
esac

[ -f "$MANIFEST" ] || { echo "no register at $MANIFEST" >&2; exit 1; }
rows="$(grep -vE '^[[:space:]]*(#|$)' "$MANIFEST" | awk -F'|' 'NF > 5')"

for name in "$DB_NAME" "${DB_NAME//_/-}"; do
  if awk -F'|' -v n="$name" '$1 == n { found = 1 } END { exit !found }' <<<"$rows"; then
    echo "apps.conf has a row named '$name'; refusing (retire the site and remove its row first)" >&2
    exit 1
  fi
done

users="$(awk -F'|' -v d="$DB_NAME" '$6 == d { print $1 }' <<<"$rows" | tr '\n' ' ')"
if [ -n "${users// /}" ]; then
  echo "'$DB_NAME' is the db column of: ${users% }; refusing" >&2
  exit 1
fi

printf '%s\n' "$DB_NAME"
