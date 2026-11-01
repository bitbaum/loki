#!/usr/bin/env bash
# Switch a product from Auth.js to its staged AccountKit runtime on the box, or
# back, from GitHub (.github/workflows/accountkit-switch.yml) over the deploy's
# SSH. Each product staged AccountKit beside Auth.js behind AUTH_RUNTIME, with
# its tables migrated and an import that copies accounts into them
# (<repo>/scripts/db/accountkit-import.sql, the file given here).
#
#   accountkit-switch.sh <app> survey   <import.sql>  counts only, changes nothing
#   accountkit-switch.sh <app> switch   <import.sql>  import, AUTH_RUNTIME=accountkit, restart, prove
#   accountkit-switch.sh <app> rollback <import.sql>  AUTH_RUNTIME off, mirrors dropped, shared tables emptied
#
# survey reports how many people could sign in before and could not after: an
# account whose only way in is an Auth.js social provider the product offers
# today, with no password and no OrangeCat link. switch refuses while that
# number is above zero; those people are told first, or the provider comes
# through the bitbaum sign-in.
#
# switch proves the result on the public site with a throwaway account it
# creates on the box (a random password hashed here, sent over SSH, never
# printed): AccountKit answers /api/auth/get-session, the account signs in
# through the product's own sign-in route, its session reads back, sign-out
# ends it. The account is deleted afterwards. Any failed step rolls back.
#
# This repo is public, so the log is too: it prints counts and verdicts only.
set -euo pipefail

APP="${1:?usage: accountkit-switch.sh <app> survey|switch|rollback <import.sql>}"
ACTION="${2:?usage: accountkit-switch.sh <app> survey|switch|rollback <import.sql>}"
SQL="${3:?usage: accountkit-switch.sh <app> survey|switch|rollback <import.sql>}"
case "$ACTION" in survey|switch|rollback) ;; *) echo "unknown action $ACTION" >&2; exit 2 ;; esac
[ -f "$SQL" ] || { echo "no import SQL at $SQL" >&2; exit 2; }

# app|database|unit|domain|password column|OrangeCat column|credentials provider|social providers offered today
REGISTRY='kivvi|kivvi|kivvi-app|kivvi.orangecat.ch|password_hash|-|credentials|-
petvity|petvity|petvity-app|petvity.orangecat.ch|password|orangecat_sub|credentials|-
surf-your-life|surf_your_life|surf-your-life-app|surf-your-life.orangecat.ch|password|orangecat_sub|credentials|-
evig|revampit|evig-app|evig.orangecat.ch|password_hash|orangecat_actor_id|credentials|-
loki|loki|loki-app|loki.orangecat.ch|password_hash|orangecat_actor_id|email-password|github'
ROW="$(grep -E "^${APP}\|" <<< "$REGISTRY" || true)"
[ -n "$ROW" ] || { echo "$APP has no AccountKit staging registered here" >&2; exit 2; }
IFS='|' read -r _ DB UNIT DOMAIN PWCOL OCCOL PROVIDER SOCIAL <<< "$ROW"

: "${HETZNER_IP:?HETZNER_IP required}"
BOX="ubuntu@$HETZNER_IP"
SSH=(ssh -o BatchMode=yes)
[ -f "$HOME/.ssh/id_deploy" ] && SSH+=(-i "$HOME/.ssh/id_deploy")

# The throwaway account's password and its AccountKit-native hash (better-auth's
# scrypt, `salt:hex`), made here so the box needs nothing installed.
PROOF_EMAIL="accountkit-proof-$(openssl rand -hex 6)@example.invalid"
PROOF_PASSWORD="$(openssl rand -hex 24)"
PROOF_HASH="$(PROOF_PASSWORD="$PROOF_PASSWORD" node -e '
  const { scryptSync, randomBytes } = require("node:crypto");
  const pw = process.env.PROOF_PASSWORD.normalize("NFKC");
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(pw, salt, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 });
  process.stdout.write(`${salt}:${key.toString("hex")}`);
')"

{
  printf 'APP=%q DB=%q UNIT=%q DOMAIN=%q PWCOL=%q OCCOL=%q PROVIDER=%q SOCIAL=%q ACTION=%q\n' \
    "$APP" "$DB" "$UNIT" "$DOMAIN" "$PWCOL" "$OCCOL" "$PROVIDER" "$SOCIAL" "$ACTION"
  printf 'PROOF_EMAIL=%q PROOF_PASSWORD=%q PROOF_HASH=%q\n' "$PROOF_EMAIL" "$PROOF_PASSWORD" "$PROOF_HASH"
  printf 'IMPORT_SQL=%q\n' "$(cat "$SQL")"
  cat <<'REMOTE'
set -euo pipefail
export LC_ALL=C LANG=C
q() { sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -qtAX "$@"; }
env_of() {
  local cand
  for cand in "/opt/$APP/shared/.env" "/opt/$APP/app/.env"; do
    [ -f "$cand" ] && { printf '%s' "$cand"; return 0; }
  done
  return 1
}
ENVF="$(env_of)" || { echo "no env file for $APP on the box" >&2; exit 1; }
value() { grep -E "^(export[[:space:]]+)?$1=" "$ENVF" | tail -n 1 | cut -d= -f2- | tr -d '"'; }
set_runtime() {  # set_runtime accountkit | set_runtime ""
  sudo sed -i -E '/^(export[[:space:]]+)?AUTH_RUNTIME=/d' "$ENVF"
  [ -z "$1" ] || printf 'AUTH_RUNTIME=%s\n' "$1" | sudo tee -a "$ENVF" >/dev/null
  sudo chmod 600 "$ENVF"
}
restart() {
  sudo systemctl restart "$UNIT"
  for _ in $(seq 30); do
    sleep 2
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/" || true)"
    [ "$(systemctl is-active "$UNIT" || true)" = active ] && [ "${code:0:1}" != 5 ] && [ "$code" != 000 ] && return 0
  done
  echo "$UNIT did not come back healthy" >&2
  return 1
}
detach_and_empty() {
  q <<'SQL'
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tgname, tgrelid::regclass AS rel FROM pg_trigger
           WHERE NOT tgisinternal AND tgname LIKE '%\_accountkit\_%' LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.rel);
  END LOOP;
END $$;
TRUNCATE auth_users, auth_accounts, auth_sessions, auth_verifications, auth_passkeys, auth_two_factors CASCADE;
SQL
}

survey() {
  local oc="false" social="false"
  [ "$OCCOL" != - ] && oc="u.$OCCOL IS NOT NULL"
  if [ "$SOCIAL" != - ]; then
    social="EXISTS (SELECT 1 FROM accounts a WHERE a.user_id = u.id AND a.provider = ANY (string_to_array('$SOCIAL', ',')))"
  fi
  q -F ' ' <<SQL
SELECT 'accounts=' || count(*),
  'with_password=' || count(*) FILTER (WHERE u.$PWCOL IS NOT NULL),
  'with_orangecat=' || count(*) FILTER (WHERE $oc),
  'locked_out=' || count(*) FILTER (WHERE u.$PWCOL IS NULL AND NOT ($oc) AND $social),
  'shared_rows=' || (SELECT count(*) FROM auth_users),
  'mirrors=' || (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%\_accountkit\_%')
FROM users u;
SQL
  echo "runtime=$(value AUTH_RUNTIME || true)"
}

rollback() {
  set_runtime ""
  restart
  detach_and_empty
  echo "rolled back: AUTH_RUNTIME unset, $UNIT restarted on Auth.js, mirrors dropped, shared tables emptied"
}

prove() {
  local jar body sess uid
  jar="$(mktemp)"
  [ "$(curl -s --max-time 15 "https://$DOMAIN/api/auth/get-session")" = null ] \
    || { echo "proof: AccountKit does not answer /api/auth/get-session"; return 1; }
  uid="$(q -c "INSERT INTO users (email, name, $PWCOL) VALUES ('$PROOF_EMAIL', 'AccountKit proof', '$PROOF_HASH') RETURNING id" | head -n 1)"
  [ -n "$uid" ] || { echo "proof: could not create the throwaway account"; return 1; }
  trap "q -c \"DELETE FROM users WHERE id = '$uid'\" >/dev/null 2>&1 || true; rm -f '$jar'" RETURN
  body="$(curl -s --max-time 20 -c "$jar" -b "$jar" -H "origin: https://$DOMAIN" \
    --data-urlencode "email=$PROOF_EMAIL" --data-urlencode "password=$PROOF_PASSWORD" \
    --data-urlencode "callbackUrl=https://$DOMAIN/" --data-urlencode "csrfToken=accountkit" \
    "https://$DOMAIN/api/auth/callback/$PROVIDER")"
  case "$body" in *'"url"'*) ;; *) echo "proof: sign-in did not answer next-auth/react's shape"; return 1 ;; esac
  case "$body" in *error=*) echo "proof: the throwaway account was refused"; return 1 ;; esac
  sess="$(curl -s --max-time 15 -b "$jar" "https://$DOMAIN/api/auth/session")"
  case "$sess" in *"$PROOF_EMAIL"*) ;; *) echo "proof: the session did not read back"; return 1 ;; esac
  curl -s --max-time 15 -c "$jar" -b "$jar" -H "origin: https://$DOMAIN" \
    --data-urlencode "csrfToken=accountkit" --data-urlencode "callbackUrl=https://$DOMAIN/" \
    "https://$DOMAIN/api/auth/signout" >/dev/null
  [ "$(curl -s --max-time 15 -b "$jar" "https://$DOMAIN/api/auth/session")" = null ] \
    || { echo "proof: sign-out did not end the session"; return 1; }
  echo "proof: AccountKit answers; a fresh account signed in, read its session, signed out"
}

case "$ACTION" in
  survey) survey ;;
  rollback) rollback ;;
  switch)
    s="$(survey)"; echo "$s"
    case "$s" in *runtime=accountkit*) echo "$APP already runs on AccountKit; nothing to do"; exit 0 ;; esac
    case "$s" in *" locked_out=0 "*) ;; *) echo "refused: people whose only way in is $SOCIAL would be locked out"; exit 1 ;; esac
    # AccountKit needs a session secret of at least 32 characters in production.
    if [ "$(value BETTER_AUTH_SECRET | wc -c)" -le 32 ]; then
      sudo sed -i -E '/^(export[[:space:]]+)?BETTER_AUTH_SECRET=/d' "$ENVF"
      printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)" | sudo tee -a "$ENVF" >/dev/null
      echo "BETTER_AUTH_SECRET: added"
    fi
    # Leftovers of an earlier attempt (rows, mirrors) would read as drift.
    case "$s" in *" shared_rows=0 mirrors=0"*) ;; *) detach_and_empty; echo "cleared an earlier attempt's shared rows" ;; esac
    # Import under locks; the mirror triggers it attaches keep both sides in
    # step from the moment it commits, while Auth.js still answers.
    printf '%s\n' "SET lock_timeout = '10s';" "$IMPORT_SQL" | q -1 >/dev/null
    echo "import: committed, mirrors attached ($(q -c 'SELECT count(*) FROM auth_users') shared accounts)"
    set_runtime accountkit
    restart || { echo "restart failed; rolling back"; rollback; exit 1; }
    if prove; then
      echo "switched: $APP runs on AccountKit"
    else
      echo "proof failed; rolling back"; rollback; exit 1
    fi
    ;;
esac
REMOTE
} | "${SSH[@]}" "$BOX" 'bash -s'
