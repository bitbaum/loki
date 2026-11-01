#!/usr/bin/env bash
# provisionable-db.sh <app> — print the host database provision-db-on-box.sh
# would create for <app>, or refuse.
#
# The gate in front of .github/workflows/provision-db.yml. provision-db-on-box.sh
# takes any slug and derives the database from it (`-` → `_`); from a laptop the
# person running it knows which apps that is right for. A workflow input does
# not, so this answers from the register instead:
#
#   - the app must have an apps.conf row;
#   - its `db` column must be a HOST database name — not '-' (no database) and
#     not `supabase:<schema>` (that lives in the supabase-db container, which
#     this script does not touch);
#   - that name must be the one the script derives from the slug. A row like
#     `revamp-info|…|hirnli` is provisioned under another name; running the
#     script for it would make a second, empty `revamp_info` database next to
#     the real one and point nothing at it.
#
# Prints names only (an app and a database name are not secrets).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$HERE/lib.sh"

APP="${1:-}"
[[ "$APP" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || {
  echo "app name must be a slug ([a-z0-9-]): '$APP'" >&2; exit 2; }

app_lookup "$APP" || exit 1

case "$DB" in
  ""|-)       echo "$APP has no database in apps.conf (db column '-'); nothing to provision" >&2; exit 1 ;;
  supabase:*) echo "$APP lives in the supabase-db container ($DB); provision-db-on-box.sh is for host databases only" >&2; exit 1 ;;
esac
[[ "$DB" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || {
  echo "$APP's db column '$DB' is not a plain host database name" >&2; exit 1; }

derived="${APP//-/_}"
[ "$DB" = "$derived" ] || {
  echo "$APP's register database is '$DB', but provision-db-on-box.sh would create '$derived'; refusing" >&2; exit 1; }

[ "${STATUS:-}" != archived ] || { echo "$APP is archived; refusing" >&2; exit 1; }

printf '%s\n' "$DB"
