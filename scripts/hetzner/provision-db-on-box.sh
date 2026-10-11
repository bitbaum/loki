#!/usr/bin/env bash
#
# Give a starter site its database and its secrets, ON THE BOX.
#
#   provision-db-on-box.sh <slug> [seed-env-file]
#
# The fleet starter (scripts/site-template = bitbaum/fleet templates/app) keeps
# accounts in Postgres and signs sessions with BETTER_AUTH_SECRET; without
# them the site serves pages but /api/health is red and nobody can sign up.
# This makes both true, idempotently:
#
#   1. a Postgres role and database named after the slug (`-` → `_`, the plain
#      identifier apply-schema.sh requires), owned by that role, with a random
#      password recorded in ~/.db-credentials (`<db>|<password>`, chmod 600)
#      — the file gen-env.sh already reads;
#   2. /opt/<slug>/shared/.env — the box env, which is the SSOT every deploy
#      reads — carrying DATABASE_URL, BETTER_AUTH_SECRET and SECRET_SEAL_KEY.
#      A key already there is NEVER replaced: rotating a secret signs every
#      person out (or unseals nothing), and that is a decision, not a side
#      effect of re-running a script.
#
# If the box has no env for the site yet and a seed file is given, the seed is
# copied first — the same "only when missing" rule deploy.sh applies — so the
# widget token and site URL that new-site.sh wrote locally are not lost.
#
# SECRETS NEVER LEAVE THE BOX. They are generated there with openssl and
# written there; nothing is printed but the names of the keys that are present.
# Prints the database name on success (for the register's `db` column).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$HERE/lib.sh"

SLUG="${1:-}"; SEED="${2:-}"
[[ "$SLUG" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || {
  echo "usage: provision-db-on-box.sh <slug> [seed-env-file]" >&2; exit 2; }

# The database name, as apply-schema.sh will need it: a plain identifier.
db_name_for() { printf '%s' "${1//-/_}"; }
DB="$(db_name_for "$SLUG")"
[[ "$DB" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || { echo "slug '$SLUG' does not give a plain database name" >&2; exit 2; }

ssh_box() {
  if [ -r "${DEPLOY_KEY_PATH:-}" ]; then
    ssh -o BatchMode=yes -o ConnectTimeout=20 -i "$DEPLOY_KEY_PATH" "$BOX" "$@"
  else
    ssh -o BatchMode=yes -o ConnectTimeout=20 "$BOX" "$@"
  fi
}

ENV_FILE="/opt/$SLUG/shared/.env"
if [ -n "$SEED" ] && [ -f "$SEED" ]; then
  if ! ssh_box "test -f '$ENV_FILE'" </dev/null; then
    ssh_box "sudo mkdir -p /opt/$SLUG/shared && sudo chown -R ubuntu:ubuntu /opt/$SLUG && umask 077 && cat > '$ENV_FILE'" < "$SEED"
    echo "seeded $ENV_FILE from $(basename "$SEED")" >&2
  fi
fi

# Everything below runs on the box. Arguments are validated above and passed
# positionally; the script body is quoted, so nothing is interpolated twice.
ssh_box bash -s -- "$SLUG" "$DB" <<'BOX'
set -euo pipefail
SLUG="$1"; DB="$2"
ENV_FILE="/opt/$SLUG/shared/.env"
CREDS="$HOME/.db-credentials"

umask 077
touch "$CREDS"; chmod 600 "$CREDS"

psql_su() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qtAX "$@"; }

pass="$(grep "^$DB|" "$CREDS" | head -1 | cut -d'|' -f2 || true)"
if [ -z "$pass" ]; then
  pass="$(openssl rand -hex 24)"
  printf '%s|%s\n' "$DB" "$pass" >> "$CREDS"
  new_password=1
else
  new_password=0
fi

if [ -z "$(psql_su -c "select 1 from pg_roles where rolname = '$DB'")" ]; then
  psql_su -c "create role \"$DB\" login password '$pass'"
elif [ "$new_password" = 1 ]; then
  # A role exists that ~/.db-credentials did not know: it now does, with a
  # password only this file and the role share.
  psql_su -c "alter role \"$DB\" password '$pass'"
fi
if [ -z "$(psql_su -c "select 1 from pg_database where datname = '$DB'")" ]; then
  psql_su -c "create database \"$DB\" owner \"$DB\""
fi
# The app's tables live in public; the app's own role owns and reads them.
psql_su -d "$DB" -c "alter schema public owner to \"$DB\""

sudo mkdir -p "/opt/$SLUG/shared"
sudo chown -R ubuntu:ubuntu "/opt/$SLUG"
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"

has() { grep -qE "^$1=" "$ENV_FILE"; }
add() { printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; }
has DATABASE_URL       || add DATABASE_URL "postgresql://$DB:$pass@localhost:5432/$DB"
has BETTER_AUTH_SECRET || add BETTER_AUTH_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
has SECRET_SEAL_KEY    || add SECRET_SEAL_KEY "$(openssl rand -base64 48 | tr -d '\n')"

present=""
for k in DATABASE_URL BETTER_AUTH_SECRET SECRET_SEAL_KEY NEXT_PUBLIC_APP_URL NEXT_PUBLIC_FC_WIDGET_TOKEN RESEND_API_KEY; do
  has "$k" && present="$present $k"
done
echo "database $DB ready; $ENV_FILE has:$present" >&2
BOX

printf '%s\n' "$DB"
