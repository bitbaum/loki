#!/usr/bin/env bash
# Switch a product from Auth.js to its staged AccountKit runtime on the box, or
# back, from GitHub (.github/workflows/accountkit-switch.yml) over the deploy's
# SSH. Each product staged AccountKit beside Auth.js behind AUTH_RUNTIME, with
# its tables migrated and an import that copies accounts into them
# (<repo>/scripts/db/accountkit-import.sql, the file given here).
#
#   accountkit-switch.sh <app> survey   <import.sql>  counts only, changes nothing
#   accountkit-switch.sh <app> switch   <import.sql>  import, AUTH_RUNTIME=accountkit, restart, prove
#   accountkit-switch.sh <app> rollback <import.sql>  AUTH_RUNTIME off, mirrors dropped, shared tables emptied;
#                                                     refused once they hold credentials found nowhere else
#   accountkit-switch.sh <app> prove    <import.sql>  the account journeys, live, on a switched app
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
# prove runs the journeys a person relies on, on the public site, with
# throwaway accounts it deletes again:
#   - two sessions at once, and a change to the person's row read on the next
#     request (the session is re-read from the product's row every time);
#   - a password write to the product's row (what its reset and change-password
#     writers do) ends both sessions; the old password is refused, the new one
#     signs in;
#   - sign-out ends a session, and deleting the person ends theirs;
#   - where the product offers OrangeCat, a real browser sign-in with a
#     throwaway OrangeCat account: the product's OrangeCat button, OrangeCat's
#     sign-in and consent, back into the product signed in
#     (scripts/hetzner/accountkit-oidc-proof.mjs).
#
# This repo is public, so the log is too: it prints counts and verdicts only.
set -euo pipefail

APP="${1:?usage: accountkit-switch.sh <app> survey|switch|rollback <import.sql>}"
ACTION="${2:?usage: accountkit-switch.sh <app> survey|switch|rollback <import.sql>}"
SQL="${3:?usage: accountkit-switch.sh <app> survey|switch|rollback <import.sql>}"
case "$ACTION" in survey|switch|rollback|prove) ;; *) echo "unknown action $ACTION" >&2; exit 2 ;; esac
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
native_hash() {
  PW="$1" node -e '
    const { scryptSync, randomBytes } = require("node:crypto");
    const pw = process.env.PW.normalize("NFKC");
    const salt = randomBytes(16).toString("hex");
    const key = scryptSync(pw, salt, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 });
    process.stdout.write(`${salt}:${key.toString("hex")}`);
  '
}
PROOF_HASH="$(native_hash "$PROOF_PASSWORD")"
# prove's second password, and its throwaway OrangeCat account.
PROOF_PASSWORD2="$(openssl rand -hex 24)"
PROOF_HASH2="$(native_hash "$PROOF_PASSWORD2")"
OC_EMAIL="accountkit-proof-$(openssl rand -hex 6)@example.invalid"
OC_PASSWORD="Ak-$(openssl rand -hex 18)"

remote() {  # remote <step> [PRODUCT_USER_ID]
{
  printf 'APP=%q DB=%q UNIT=%q DOMAIN=%q PWCOL=%q OCCOL=%q PROVIDER=%q SOCIAL=%q ACTION=%q PRODUCT_USER_ID=%q\n' \
    "$APP" "$DB" "$UNIT" "$DOMAIN" "$PWCOL" "$OCCOL" "$PROVIDER" "$SOCIAL" "$1" "${2:-}"
  printf 'PROOF_EMAIL=%q PROOF_PASSWORD=%q PROOF_HASH=%q\n' "$PROOF_EMAIL" "$PROOF_PASSWORD" "$PROOF_HASH"
  printf 'PROOF_PASSWORD2=%q PROOF_HASH2=%q OC_EMAIL=%q OC_PASSWORD=%q\n' "$PROOF_PASSWORD2" "$PROOF_HASH2" "$OC_EMAIL" "$OC_PASSWORD"
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

# Credentials that exist only in the shared tables: a password set through
# AccountKit (its native scrypt, not an imported bcrypt or $bs1$ hash), a
# passkey, a second factor. Once a product renders AccountKit's own screens
# these appear, and emptying the tables would lock those people out.
native_only() {
  q <<'SQL'
SELECT (SELECT count(*) FROM auth_accounts WHERE provider_id = 'credential'
          AND password IS NOT NULL AND password !~ '^[$]2[aby][$]' AND password !~ '^[$]bs1[$]')
     + (SELECT count(*) FROM auth_passkeys)
     + (SELECT count(*) FROM auth_two_factors);
SQL
}

rollback() {
  local only
  only="$(native_only)"
  if [ "${only:-0}" != 0 ]; then
    echo "refused: the shared tables hold $only credential(s) that exist nowhere else" >&2
    echo "(passwords set through AccountKit, passkeys, second factors); emptying them" >&2
    echo "would lock those people out. Roll back the product's screens by reverting" >&2
    echo "its pull request instead; the shared runtime keeps answering. Nothing changed." >&2
    return 1
  fi
  set_runtime ""
  restart
  detach_and_empty
  echo "rolled back: AUTH_RUNTIME unset, $UNIT restarted on Auth.js, mirrors dropped, shared tables emptied"
}

# One person's browser: a cookie jar, and next-auth/react's calls.
sign_in() {  # sign_in <jar> <email> <password>: the answer's body
  curl -s --max-time 20 -c "$1" -b "$1" -H "origin: https://$DOMAIN" \
    --data-urlencode "email=$2" --data-urlencode "password=$3" \
    --data-urlencode "callbackUrl=https://$DOMAIN/" --data-urlencode "csrfToken=accountkit" \
    "https://$DOMAIN/api/auth/callback/$PROVIDER"
}
signed_in() {  # signed_in <jar> <body>: the answer is next-auth/react's success
  case "$2" in *'"url"'*) ;; *) return 1 ;; esac
  case "$2" in *error=*) return 1 ;; esac
}
session() { curl -s --max-time 15 -b "$1" "https://$DOMAIN/api/auth/session"; }
sign_out() {
  curl -s --max-time 15 -c "$1" -b "$1" -H "origin: https://$DOMAIN" \
    --data-urlencode "csrfToken=accountkit" --data-urlencode "callbackUrl=https://$DOMAIN/" \
    "https://$DOMAIN/api/auth/signout" >/dev/null
}
fail() { echo "proof: $*"; return 1; }

answers_null() {
  [ "$(curl -s --max-time 15 "https://$DOMAIN/api/auth/get-session")" = null ] \
    || fail "AccountKit does not answer /api/auth/get-session"
}

prove() {
  local jar uid
  jar="$(mktemp)"
  answers_null || return 1
  uid="$(q -c "INSERT INTO users (email, name, $PWCOL) VALUES ('$PROOF_EMAIL', 'AccountKit proof', '$PROOF_HASH') RETURNING id" | head -n 1)"
  [ -n "$uid" ] || fail "could not create the throwaway account" || return 1
  trap "q -c \"DELETE FROM users WHERE id = '$uid'\" >/dev/null 2>&1 || true; rm -f '$jar'" RETURN
  signed_in "$jar" "$(sign_in "$jar" "$PROOF_EMAIL" "$PROOF_PASSWORD")" \
    || fail "the throwaway account was refused" || return 1
  case "$(session "$jar")" in *"$PROOF_EMAIL"*) ;; *) fail "the session did not read back"; return 1 ;; esac
  sign_out "$jar"
  [ "$(session "$jar")" = null ] || fail "sign-out did not end the session" || return 1
  echo "proof: AccountKit answers; a fresh account signed in, read its session, signed out"
}

journeys() {
  local a b c uid
  a="$(mktemp)"; b="$(mktemp)"; c="$(mktemp)"
  answers_null || return 1
  uid="$(q -c "INSERT INTO users (email, name, $PWCOL) VALUES ('$PROOF_EMAIL', 'AccountKit proof', '$PROOF_HASH') RETURNING id" | head -n 1)"
  [ -n "$uid" ] || fail "could not create the throwaway account" || return 1
  trap "q -c \"DELETE FROM users WHERE id = '$uid'\" >/dev/null 2>&1 || true; q -c \"DELETE FROM auth_users WHERE email = '$PROOF_EMAIL'\" >/dev/null 2>&1 || true; rm -f '$a' '$b' '$c'" RETURN

  signed_in "$a" "$(sign_in "$a" "$PROOF_EMAIL" "$PROOF_PASSWORD")" || fail "sign-in refused" || return 1
  signed_in "$b" "$(sign_in "$b" "$PROOF_EMAIL" "$PROOF_PASSWORD")" || fail "a second sign-in refused" || return 1
  case "$(session "$a")$(session "$b")" in *"$PROOF_EMAIL"*"$PROOF_EMAIL"*) ;; *) fail "two sessions did not both read back"; return 1 ;; esac
  echo "journey: signed in twice; both sessions read back"

  q -c "UPDATE users SET name = 'AccountKit proof renamed' WHERE id = '$uid'" >/dev/null
  case "$(session "$a")" in *"AccountKit proof renamed"*) ;; *) fail "a change to the person's row did not reach the session"; return 1 ;; esac
  echo "journey: a change to the person's row is in the session on the next request"

  # What the product's reset and change-password writers do: write the row.
  q -c "UPDATE users SET $PWCOL = '$PROOF_HASH2' WHERE id = '$uid'" >/dev/null
  [ "$(session "$a")" = null ] && [ "$(session "$b")" = null ] \
    || fail "a password write did not end the other sessions" || return 1
  echo "journey: a password write ended both sessions"
  if signed_in "$c" "$(sign_in "$c" "$PROOF_EMAIL" "$PROOF_PASSWORD")"; then
    fail "the old password still signs in"; return 1
  fi
  signed_in "$c" "$(sign_in "$c" "$PROOF_EMAIL" "$PROOF_PASSWORD2")" || fail "the new password was refused" || return 1
  case "$(session "$c")" in *"$PROOF_EMAIL"*) ;; *) fail "the new password's session did not read back"; return 1 ;; esac
  echo "journey: the old password is refused; the new one signs in"

  sign_out "$c"
  [ "$(session "$c")" = null ] || fail "sign-out did not end the session" || return 1
  signed_in "$c" "$(sign_in "$c" "$PROOF_EMAIL" "$PROOF_PASSWORD2")" || fail "signing in again was refused" || return 1
  q -c "DELETE FROM users WHERE id = '$uid'" >/dev/null
  [ "$(session "$c")" = null ] || fail "deleting the person did not end their session" || return 1
  echo "journey: sign-out ends a session; deleting the person ends theirs"
}

# OrangeCat's own Supabase, for a throwaway OrangeCat account.
oc_credentials() {  # "<url> <service key>", from OrangeCat's env on this box
  local envf
  for envf in /opt/orangecat/shared/.env /opt/orangecat/app/.env; do [ -f "$envf" ] && break; done
  printf '%s %s' \
    "$(sudo grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$envf" | tail -n 1 | cut -d= -f2- | tr -d '"')" \
    "$(sudo grep -E '^SUPABASE_SERVICE_ROLE_KEY=' "$envf" | tail -n 1 | cut -d= -f2- | tr -d '"')"
}
oc_admin() {  # oc_admin <method> <path> [json]
  local url key
  read -r url key <<< "$(oc_credentials)"
  curl -s --max-time 20 -X "$1" -H "apikey: $key" -H "Authorization: Bearer $key" \
    -H 'content-type: application/json' ${3:+--data "$3"} "$url/auth/v1$2"
}
oc_rest() {  # oc_rest <path>: OrangeCat's PostgREST, as the service role
  local url key
  read -r url key <<< "$(oc_credentials)"
  curl -s --max-time 20 -H "apikey: $key" -H "Authorization: Bearer $key" "$url/rest/v1$1"
}
oc_user_id() {
  oc_admin GET "/admin/users?per_page=1000" | python3 -c '
import json, sys
email = sys.argv[1]
for u in json.load(sys.stdin).get("users", []):
    if u.get("email") == email: print(u["id"])' "$OC_EMAIL"
}
oc_create() {
  oc_admin POST /admin/users "{\"email\":\"$OC_EMAIL\",\"password\":\"$OC_PASSWORD\",\"email_confirm\":true}" >/dev/null
  [ -n "$(oc_user_id)" ] || fail "could not create a throwaway OrangeCat account" || return 1
  echo "oidc: a throwaway OrangeCat account exists"
}
oc_cleanup() {
  local oc actor ids id
  oc="$(oc_user_id)"
  # OrangeCat's sub is the actor id: it finds the product's person even when
  # the browser step failed before printing one.
  actor=""
  [ -z "$oc" ] || actor="$(oc_rest "/actors?select=id&user_id=eq.$oc" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
print(rows[0]["id"] if isinstance(rows, list) and rows else "")')"
  ids="$PRODUCT_USER_ID"
  [ -z "$actor" ] || ids="$ids $(q -c "SELECT user_id FROM auth_accounts WHERE provider_id = 'orangecat' AND account_id = '$actor'" | tr '\n' ' ')"
  for id in $ids; do
    q -c "DELETE FROM users WHERE id::text = '$id'" >/dev/null 2>&1 || true
    q -c "DELETE FROM auth_users WHERE id = '$id'" >/dev/null 2>&1 || true
  done
  [ -z "$oc" ] || oc_admin DELETE "/admin/users/$oc" >/dev/null
  echo "oidc: the throwaway accounts are deleted"
}

case "$ACTION" in
  survey) survey ;;
  rollback) rollback ;;
  journeys) journeys ;;
  oc-create) oc_create ;;
  oc-cleanup) oc_cleanup ;;
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
}

if [ "$ACTION" != prove ]; then
  remote "$ACTION"
  exit 0
fi

remote journeys
if [ "$OCCOL" = - ]; then
  echo "oidc: $APP offers no OrangeCat sign-in; nothing to prove"
  exit 0
fi
remote oc-create
product_user=""
cleanup() { remote oc-cleanup "$product_user" || true; }
trap cleanup EXIT
product_user="$(DOMAIN="$DOMAIN" OC_EMAIL="$OC_EMAIL" OC_PASSWORD="$OC_PASSWORD" \
  node "$(dirname "$0")/accountkit-oidc-proof.mjs")"
echo "oidc: OrangeCat's button, OrangeCat's sign-in and consent, back into $APP signed in"
