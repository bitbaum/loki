#!/usr/bin/env bash
# Accounts for an app that kept its people in OrangeCat's GoTrue
# (auth.users) and its data in a supabase schema, moving to AccountKit in its
# host accounts database (accounts-db.conf). Run from GitHub
# (.github/workflows/accountkit-supabase.yml) over the deploy's SSH.
#
#   accountkit-supabase.sh <app> survey   <people.sql> <import.sql>   counts only
#   accountkit-supabase.sh <app> rehearse <people.sql> <import.sql>   the import in a transaction that always rolls back; counts only
#   accountkit-supabase.sh <app> import   <people.sql> <import.sql>   the import, committed
#
# Two files from the app's repo say what is the app's own:
#   people.sql  runs in the supabase-db container and prints one line per
#               person who owns rows in the app's schema: `<gotrue user id>|<OrangeCat actor id>`
#               (the actor id empty when OrangeCat has none). OrangeCat's OIDC
#               `sub` is the actor id.
#   import.sql  runs in the accounts database with those lines in the temp
#               table oc_people(user_id uuid, actor_id text). It writes an
#               AccountKit user under the SAME id and an `orangecat` account
#               keyed by the actor id, so a person's first "Continue with
#               OrangeCat" lands on the account their rows already name. It
#               links by actor id only, never by an address, and must end with
#               one SELECT of counts.
#
# Nothing here deletes or empties anything: the rollback for an app is
# reverting its pull request, and the accounts tables keep every credential.
# This repo is public, so the log is too: counts and verdicts only.
set -euo pipefail

APP="${1:?usage: accountkit-supabase.sh <app> survey|rehearse|import <people.sql> <import.sql>}"
ACTION="${2:?}"
PEOPLE_SQL="${3:?}"
IMPORT_SQL="${4:?}"
case "$ACTION" in survey|rehearse|import) ;; *) echo "unknown action $ACTION" >&2; exit 2 ;; esac
for f in "$PEOPLE_SQL" "$IMPORT_SQL"; do [ -f "$f" ] || { echo "no SQL at $f" >&2; exit 2; }; done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"
app_lookup "$APP" >/dev/null
case "$DB" in supabase:*) ;; *) echo "$APP's db is '$DB', not a supabase schema" >&2; exit 2 ;; esac
ACCOUNTS_DB="$(accounts_db_of "$APP")"
[ -n "$ACCOUNTS_DB" ] || { echo "$APP has no accounts database in accounts-db.conf" >&2; exit 2; }

SSH=(ssh -o BatchMode=yes)
[ -f "$HOME/.ssh/id_deploy" ] && SSH+=(-i "$HOME/.ssh/id_deploy")

{
  printf 'APP=%q ACCOUNTS_DB=%q ACTION=%q\n' "$APP" "$ACCOUNTS_DB" "$ACTION"
  printf 'PEOPLE_SQL=%q\n' "$(cat "$PEOPLE_SQL")"
  printf 'IMPORT_SQL=%q\n' "$(cat "$IMPORT_SQL")"
  cat <<'REMOTE'
set -euo pipefail
export LC_ALL=C LANG=C
people="$(printf '%s\n' "$PEOPLE_SQL" | sudo docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtAX -f -)"
total="$(printf '%s\n' "$people" | grep -c '|' || true)"
linked="$(printf '%s\n' "$people" | grep -cE '\|.+$' || true)"
echo "people_with_rows=$total with_orangecat_actor=$linked without_actor=$((total - linked))"
q() { sudo -u postgres psql -d "$ACCOUNTS_DB" -v ON_ERROR_STOP=1 -qtAX "$@"; }
[ "$(q -c "SELECT to_regclass('public.users') IS NOT NULL")" = t ] \
  || { echo "the accounts tables are not in $ACCOUNTS_DB yet: deploy the app first"; exit 1; }
echo "accounts_db_users=$(q -c 'SELECT count(*) FROM users') accounts_db_orangecat_links=$(q -c "SELECT count(*) FROM accounts WHERE provider_id = 'orangecat'")"
[ "$ACTION" = survey ] && exit 0
end=ROLLBACK
[ "$ACTION" = import ] && end=COMMIT
{
  echo "BEGIN;"
  echo "SET LOCAL lock_timeout = '10s';"
  echo "CREATE TEMP TABLE oc_people (user_id uuid PRIMARY KEY, actor_id text) ON COMMIT DROP;"
  echo "COPY oc_people (user_id, actor_id) FROM STDIN WITH (FORMAT text, DELIMITER '|', NULL '');"
  printf '%s\n' "$people" | grep '|' || true
  echo '\.'
  printf '%s\n' "$IMPORT_SQL"
  echo "$end;"
} | q -F ' '
echo "$ACTION: $([ "$end" = COMMIT ] && echo committed || echo rolled back)"
REMOTE
} | "${SSH[@]}" "$BOX" 'bash -s'
