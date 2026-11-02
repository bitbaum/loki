#!/usr/bin/env bash
# The AccountKit switch for products whose own tables are not Auth.js's
# `users` with a password column: Vitareba (a clinic: patients' health data)
# and AOZ (a housing service: residents' personal data). Run from GitHub by
# .github/workflows/accountkit-switch.yml over the deploy's SSH, beside
# accountkit-switch.sh, which serves the products it registers.
#
#   accountkit-cutover.sh <app> survey   <import.sql>  counts only; changes nothing
#   accountkit-cutover.sh <app> rehearse <import.sql>  last night's dump restored into a
#                                                      temporary database, the import run
#                                                      there and rolled back, counts printed,
#                                                      the database dropped: the restore proof
#   accountkit-cutover.sh <app> switch   <import.sql>  fresh dump, rehearsed; then import,
#                                                      AUTH_RUNTIME=accountkit, restart, prove
#   accountkit-cutover.sh <app> rollback <import.sql>  AUTH_RUNTIME emptied and a restart.
#                                                      Nothing else: no table is emptied
#   accountkit-cutover.sh <app> prove    <import.sql>  on a switched app with AccountKit's own
#                                                      screens: sign up, sign out, a wrong
#                                                      password refused, sign in, delete
#
# The imported-account proof never uses a person's password. Before the import
# a throwaway legacy account at an `.invalid` address is written the way the
# product's own writers wrote one (a bcrypt hash of a random password made on
# the runner, never printed); the import carries it like everyone else, and it
# then signs in on the public site. In the rehearsal the same is done inside
# the restored copy, and its imported hash is checked against the password by
# PostgreSQL's pgcrypto.
#
# This repo is public, so the log is too: counts, verdicts and a short digest
# of staff roles (equal before and after) — never an address, a name, a hash
# or a secret.
set -euo pipefail

APP="${1:?usage: accountkit-cutover.sh <app> survey|rehearse|switch|rollback|prove <import.sql>}"
ACTION="${2:?usage: accountkit-cutover.sh <app> survey|rehearse|switch|rollback|prove <import.sql>}"
SQL="${3:?usage: accountkit-cutover.sh <app> survey|rehearse|switch|rollback|prove <import.sql>}"
case "$ACTION" in survey|rehearse|switch|rollback|prove) ;; *) echo "unknown action $ACTION" >&2; exit 2 ;; esac
[ -f "$SQL" ] || { echo "no import SQL at $SQL" >&2; exit 2; }

# app (repository)|box name (apps.conf)|database|public domain
REGISTRY='vitareba|vitareba|vitareba|vita.orangecat.ch
aoz-begleitung|aoz-wohnen|aoz_wohnen|aoz.orangecat.ch'
ROW="$(grep -E "^${APP}\|" <<< "$REGISTRY" || true)"
[ -n "$ROW" ] || { echo "$APP is not registered in accountkit-cutover.sh" >&2; exit 2; }
IFS='|' read -r _ BOXNAME DB DOMAIN <<< "$ROW"

: "${HETZNER_IP:?HETZNER_IP required}"
BOX="ubuntu@$HETZNER_IP"
SSH=(ssh -o BatchMode=yes)
[ -f "$HOME/.ssh/id_deploy" ] && SSH+=(-i "$HOME/.ssh/id_deploy")

# The throwaway accounts: random passwords, and the legacy account's bcrypt
# hash ($2a$, which both bcryptjs and pgcrypto read) made here.
PROOF_EMAIL="accountkit-proof-$(openssl rand -hex 6)@example.invalid"
PROOF_PASSWORD="$(openssl rand -hex 24)"
SIGNUP_EMAIL="accountkit-proof-$(openssl rand -hex 6)@example.invalid"
SIGNUP_PASSWORD="$(openssl rand -hex 24)"
LEGACY_HASH=""
if [ "$ACTION" = switch ] || [ "$ACTION" = rehearse ]; then
  LEGACY_HASH="$(PW="$PROOF_PASSWORD" node -e '
    const bcrypt = require(process.argv[1]);
    process.stdout.write(bcrypt.hashSync(process.env.PW, bcrypt.genSaltSync(12)));
  ' "$(cd "$(dirname "$0")" && pwd)/node_modules/bcryptjs")"
  case "$LEGACY_HASH" in '$2a$'*) ;; *) echo "could not make the legacy proof hash" >&2; exit 1 ;; esac
fi

{
  printf 'APP=%q BOXNAME=%q DB=%q DOMAIN=%q ACTION=%q\n' "$APP" "$BOXNAME" "$DB" "$DOMAIN" "$ACTION"
  printf 'PROOF_EMAIL=%q PROOF_PASSWORD=%q LEGACY_HASH=%q\n' "$PROOF_EMAIL" "$PROOF_PASSWORD" "$LEGACY_HASH"
  printf 'SIGNUP_EMAIL=%q SIGNUP_PASSWORD=%q\n' "$SIGNUP_EMAIL" "$SIGNUP_PASSWORD"
  printf 'IMPORT_SQL=%q\n' "$(cat "$SQL")"
  cat <<'REMOTE'
set -euo pipefail
export LC_ALL=C LANG=C
UNIT="$BOXNAME-app"
DUMPS=/opt/backups/pg
qdb() { local db="$1"; shift; sudo -u postgres psql -d "$db" -v ON_ERROR_STOP=1 -qtAX "$@"; }
q() { qdb "$DB" "$@"; }
env_of() {
  local cand
  for cand in "/opt/$BOXNAME/shared/.env" "/opt/$BOXNAME/app/.env"; do
    [ -f "$cand" ] && { printf '%s' "$cand"; return 0; }
  done
  return 1
}
ENVF="$(env_of)" || { echo "no env file for $BOXNAME on the box" >&2; exit 1; }
value() { sudo grep -E "^(export[[:space:]]+)?$1=" "$ENVF" | tail -n 1 | cut -d= -f2- | tr -d '"' || true; }
set_runtime() {  # set_runtime accountkit | set_runtime ""
  sudo sed -i -E '/^(export[[:space:]]+)?AUTH_RUNTIME=/d' "$ENVF"
  [ -z "$1" ] || printf 'AUTH_RUNTIME=%s\n' "$1" | sudo tee -a "$ENVF" >/dev/null
  sudo chmod 600 "$ENVF"
}
healthy() {
  local code
  for _ in $(seq 30); do
    sleep 2
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/" || true)"
    [ "$(systemctl is-active "$UNIT" || true)" = active ] && [ "${code:0:1}" != 5 ] && [ "$code" != 000 ] && return 0
  done
  echo "$UNIT did not come back healthy" >&2
  return 1
}
restart() { sudo systemctl restart "$UNIT"; healthy; }

# ── Per product: its tables, read for counts only ────────────────────────────
# SHARED_*: where this product keeps AccountKit's tables.
# ROLES_DIGEST: who may do what (roles, scopes, admin flags), reduced to 12
# hex characters, so "unchanged" is visible without printing a row.
case "$APP" in
  vitareba)
    SHARED_USERS=auth_users SHARED_ACCOUNTS=auth_accounts SHARED_SESSIONS=auth_sessions
    SHARED_PASSKEYS=auth_passkeys SHARED_FACTORS=auth_two_factors
    SURVEY_SQL="SELECT 'accounts=' || count(*),
  'with_password=' || count(*) FILTER (WHERE u.password IS NOT NULL),
  'verified=' || count(*) FILTER (WHERE u.email_verified IS NOT NULL),
  'google_links=' || (SELECT count(*) FROM accounts WHERE provider = 'google'),
  'google_only=' || count(*) FILTER (WHERE u.password IS NULL
    AND EXISTS (SELECT 1 FROM accounts a WHERE a.user_id = u.id AND a.provider = 'google')),
  'other_links=' || (SELECT count(*) FROM accounts WHERE provider <> 'google'),
  'admins=' || count(*) FILTER (WHERE u.role = 'admin'),
  'clinicians=' || count(*) FILTER (WHERE u.is_clinician)
FROM users u;"
    ROLES_SQL="SELECT left(md5(coalesce(string_agg(id::text || ':' || role || ':' || is_clinician, ',' ORDER BY id), '')), 12) FROM users WHERE email NOT LIKE 'accountkit-proof-%@example.invalid';"
    REHEARSAL_COUNTS="SELECT 'accounts=' || (SELECT count(*) FROM vita_accountkit_users),
  'password_accounts=' || (SELECT count(*) FROM vita_accountkit_users WHERE password IS NOT NULL),
  'verified_addresses=' || (SELECT count(*) FROM vita_accountkit_users WHERE verified),
  'provider_links=' || (SELECT count(*) FROM vita_accountkit_links),
  'google_links=' || (SELECT count(*) FROM vita_accountkit_links WHERE provider_id = 'google'),
  'hashes_changed=' || (SELECT count(*) FROM users u JOIN auth_accounts c
      ON c.user_id = u.id::text AND c.provider_id = 'credential' WHERE c.password IS DISTINCT FROM u.password),
  'hashes_unreadable=' || (SELECT count(*) FROM auth_accounts WHERE provider_id = 'credential'
      AND password !~ '^[\$]2[aby][\$]' AND password !~ '^[\$]bs1[\$]');"
    proof_insert() { q -c "INSERT INTO users (email, name, password) VALUES ('$PROOF_EMAIL', 'AccountKit proof', '$LEGACY_HASH')" >/dev/null; }
    proof_hash_sql="SELECT password FROM auth_accounts c JOIN auth_users u ON u.id = c.user_id WHERE u.email = '$PROOF_EMAIL' AND c.provider_id = 'credential'"
    proof_delete() {  # proof_delete <email>
      q -c "DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM auth_users WHERE email = '$1');
            DELETE FROM auth_accounts WHERE user_id IN (SELECT id FROM auth_users WHERE email = '$1');
            DELETE FROM auth_users WHERE email = '$1';
            DELETE FROM users WHERE email = '$1';" >/dev/null 2>&1 || true
    }
    product_rows() { q -c "SELECT count(*) FROM users WHERE email = '$1'"; }
    ;;
  aoz-begleitung)
    SHARED_USERS=users SHARED_ACCOUNTS=accounts SHARED_SESSIONS=sessions
    SHARED_PASSKEYS=passkeys SHARED_FACTORS=two_factors
    SURVEY_SQL="SELECT 'accounts=' || (SELECT count(*) FROM \"Account\"),
  'with_password=' || (SELECT count(*) FROM \"Account\" WHERE \"passwordHash\" IS NOT NULL),
  'verified=' || (SELECT count(*) FROM \"Account\" WHERE \"emailVerifiedAt\" IS NOT NULL),
  'staff=' || (SELECT count(*) FROM \"User\"),
  'staff_active=' || (SELECT count(*) FROM \"User\" WHERE active),
  'residents=' || (SELECT count(*) FROM \"Resident\"),
  'staff_accounts=' || (SELECT count(*) FROM \"Account\" WHERE \"userId\" IS NOT NULL),
  'resident_accounts=' || (SELECT count(*) FROM \"Account\" WHERE \"residentId\" IS NOT NULL),
  'dual_accounts=' || (SELECT count(*) FROM \"Account\" WHERE \"userId\" IS NOT NULL AND \"residentId\" IS NOT NULL),
  'identities=' || (SELECT count(*) FROM \"AccountIdentity\"),
  'session_scopes=' || (SELECT count(*) FROM \"AccountSessionScope\");"
    ROLES_SQL="SELECT left(md5(coalesce(string_agg(id || ':' || role || ':' || scope || ':' || \"isSystemAdmin\" || ':' || \"siteAccess\" || ':' || active, ',' ORDER BY id), '')), 12) FROM \"User\";"
    REHEARSAL_COUNTS="SELECT 'identities=' || count(*),
  'legacy_accounts=' || count(*) FILTER (WHERE legacy_id IS NOT NULL),
  'password_accounts=' || count(*) FILTER (WHERE password IS NOT NULL),
  'dual_identities=' || count(*) FILTER (WHERE staff_id IS NOT NULL AND resident_id IS NOT NULL),
  'code_only_identities=' || count(*) FILTER (WHERE legacy_id IS NULL),
  'hashes_changed=' || (SELECT count(*) FROM \"Account\" a JOIN accounts c
      ON c.user_id = a.id AND c.provider_id = 'credential' WHERE c.password IS DISTINCT FROM a.\"passwordHash\"),
  'hashes_unreadable=' || (SELECT count(*) FROM accounts WHERE provider_id = 'credential'
      AND password !~ '^[\$]2[aby][\$]' AND password !~ '^[\$]bs1[\$]')
FROM aoz_accountkit_source;"
    # No staff or resident link: the proof account opens nobody's file.
    proof_insert() { q -c "INSERT INTO \"Account\" (id, email, \"passwordHash\", \"updatedAt\") VALUES ('akproof-$(openssl rand -hex 8)', '$PROOF_EMAIL', '$LEGACY_HASH', now())" >/dev/null; }
    proof_hash_sql="SELECT password FROM accounts c JOIN users u ON u.id = c.user_id WHERE u.email = '$PROOF_EMAIL' AND c.provider_id = 'credential'"
    proof_delete() {
      q -c "DELETE FROM users WHERE email = '$1';
            DELETE FROM \"Account\" WHERE email = '$1';" >/dev/null 2>&1 || true
    }
    product_rows() { q -c "SELECT count(*) FROM \"Account\" WHERE email = '$1'"; }
    ;;
esac

shared_counts() {
  q -c "SELECT 'shared_accounts=' || (SELECT count(*) FROM $SHARED_USERS),
    'shared_sessions=' || (SELECT count(*) FROM $SHARED_SESSIONS),
    'shared_passkeys=' || (SELECT count(*) FROM $SHARED_PASSKEYS),
    'shared_factors=' || (SELECT count(*) FROM $SHARED_FACTORS)" -F ' '
}
# Credentials that exist only in the shared tables (AccountKit's native
# scrypt, passkeys, second factors): what a rollback leaves behind unused.
native_only() {
  q -c "SELECT (SELECT count(*) FROM $SHARED_ACCOUNTS WHERE provider_id = 'credential'
      AND password IS NOT NULL AND password !~ '^[\$]2[aby][\$]' AND password !~ '^[\$]bs1[\$]')
    + (SELECT count(*) FROM $SHARED_PASSKEYS) + (SELECT count(*) FROM $SHARED_FACTORS)"
}

survey() {
  q -F ' ' -c "$SURVEY_SQL"
  shared_counts
  echo "roles_digest=$(q -c "$ROLES_SQL")"
  local runtime google="unset"
  runtime="$(value AUTH_RUNTIME)"
  [ -n "$(value GOOGLE_CLIENT_ID)" ] && [ -n "$(value GOOGLE_CLIENT_SECRET)" ] && google="set"
  echo "runtime=${runtime:-legacy} google_client=$google better_auth_secret=$([ "$(value BETTER_AUTH_SECRET | wc -c)" -gt 32 ] && echo set || echo unset)"
  [ "$APP" != aoz-begleitung ] || echo "staff_session_seconds=$(value SESSION_DURATION | grep . || echo 28800)"
}

# ── Backups: the box-wide nightly dump, or one made now ──────────────────────
latest_dump() {  # newest custom-format dump of $DB, at most 26 hours old
  sudo find "$DUMPS" -maxdepth 1 -type f -name "${DB}-*.dump" -mmin -1560 -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -n 1 | cut -d' ' -f2- || true
}
dump_now() {  # dump_now <label>: prints the file
  local file="$DUMPS/${DB}-$(date -u +%Y%m%d-%H%M%S)-$1.dump"
  sudo install -d -m 700 "$DUMPS"
  # Written 600 from the first byte: it holds every row of the product.
  sudo -u postgres pg_dump -Fc "$DB" | sudo sh -c "umask 077; cat > '$file'"
  sudo chmod 600 "$file"
  sudo pg_restore --list "$file" >/dev/null
  printf '%s' "$file"
}

# Restore a dump into a temporary database, run the import there inside a
# transaction with the proof account, print counts, roll back, drop it.
rehearse_from() {  # rehearse_from <dump>
  local dump="$1" tmp="${DB}_rehearse_$(date -u +%H%M%S)_$$" out ok=1
  sudo -u postgres createdb "$tmp"
  # shellcheck disable=SC2064
  trap "sudo -u postgres dropdb --if-exists '$tmp' >/dev/null 2>&1 || true" RETURN
  if ! sudo cat "$dump" | sudo -u postgres pg_restore --no-owner --no-privileges -d "$tmp" >/dev/null 2>&1; then
    # pg_restore reports harmless warnings too; the tables must be there.
    [ "$(qdb "$tmp" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")" -gt 0 ] \
      || { echo "rehearsal: the dump did not restore"; return 1; }
  fi
  echo "restore: $(basename "$dump") restored into a temporary database ($(qdb "$tmp" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'") tables)"
  local verify="SELECT 'imported_proof_hash_verifies=unavailable';"
  if qdb "$tmp" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" >/dev/null 2>&1; then
    verify="SELECT 'imported_proof_hash_verifies=' || coalesce((SELECT (crypt('$PROOF_PASSWORD', h) = h)::text FROM ($proof_hash_sql) AS p(h)), 'missing');"
  fi
  out="$( { printf '%s\n' "BEGIN;" "SET LOCAL lock_timeout = '5s';" "SET LOCAL statement_timeout = '120s';"
            case "$APP" in
              vitareba) printf '%s\n' "INSERT INTO users (email, name, password) VALUES ('$PROOF_EMAIL', 'AccountKit proof', '$LEGACY_HASH');" ;;
              aoz-begleitung) printf '%s\n' "INSERT INTO \"Account\" (id, email, \"passwordHash\", \"updatedAt\") VALUES ('akproof-rehearsal', '$PROOF_EMAIL', '$LEGACY_HASH', now());" ;;
            esac
            printf '%s\n' "$IMPORT_SQL"
            printf '%s\n' "$REHEARSAL_COUNTS"
            printf '%s\n' "$verify"
            printf '%s\n' "SELECT 'roles_digest=' || (${ROLES_SQL%;});"
            printf '%s\n' "ROLLBACK;"
          } | qdb "$tmp" -F ' ' 2>/dev/null )" || ok=0
  if [ "$ok" = 0 ]; then
    echo "rehearsal: the import failed in the restored copy; rolled back"
    return 1
  fi
  printf '%s\n' "$out" | sed 's/^/rehearsal: /'
  # The proof account is subtracted from the counts by the reader: one more
  # account and one more password than the people in the dump.
  echo "rehearsal: counts include 1 throwaway proof account; rolled back, temporary database dropped"
  case "$out" in *"hashes_changed=0"*) ;; *) echo "rehearsal: an imported hash differs from its source"; return 1 ;; esac
  case "$out" in *"hashes_unreadable=0"*) ;; *) echo "rehearsal: an imported hash is in a format AccountKit cannot read"; return 1 ;; esac
  case "$out" in
    *"imported_proof_hash_verifies=true"*) ;;
    # Without pgcrypto the switch's live sign-in of the imported proof account is the check.
    *"imported_proof_hash_verifies=unavailable"*) echo "rehearsal: pgcrypto is not installed; the imported hash is checked by the live sign-in instead" ;;
    *) echo "rehearsal: the imported proof hash did not verify"; return 1 ;;
  esac
}

rehearse() {
  local dump
  dump="$(latest_dump)"
  if [ -z "$dump" ]; then
    echo "backup: no dump of $DB from the last 26 hours; making one"
    dump="$(dump_now manual)"
  fi
  echo "backup: $(basename "$dump") ($(sudo du -h "$dump" | cut -f1), mode $(sudo stat -c %a "$dump"))"
  rehearse_from "$dump"
}

# ── The public site, as a browser would call AccountKit ──────────────────────
ak() {  # ak <jar> <path> [json]: the body, then the status on the last line
  curl -s --max-time 20 -c "$1" -b "$1" -H "origin: https://$DOMAIN" -H 'content-type: application/json' \
    ${3:+--data "$3"} -w '\n%{http_code}' "https://$DOMAIN/api/auth$2"
}
status_of() { tail -n 1 <<< "$1"; }
session_has() {  # session_has <jar> <email>
  case "$(curl -s --max-time 15 -b "$1" "https://$DOMAIN/api/auth/get-session")" in *"\"$2\""*) return 0 ;; esac
  return 1
}
fail() { echo "proof: $*"; return 1; }

# The imported throwaway account, live: a wrong password refused, its own
# password accepted, its session read back, sign-out ending it.
prove_imported() {
  local jar r
  jar="$(mktemp)"
  [ "$(curl -s --max-time 15 "https://$DOMAIN/api/auth/get-session")" = null ] || { rm -f "$jar"; fail "AccountKit does not answer /api/auth/get-session"; return 1; }
  r="$(ak "$jar" /sign-in/email "{\"email\":\"$PROOF_EMAIL\",\"password\":\"wrong-$(openssl rand -hex 6)\"}")"
  [ "$(status_of "$r")" != 200 ] || { rm -f "$jar"; fail "a wrong password signed in"; return 1; }
  r="$(ak "$jar" /sign-in/email "{\"email\":\"$PROOF_EMAIL\",\"password\":\"$PROOF_PASSWORD\"}")"
  [ "$(status_of "$r")" = 200 ] || { rm -f "$jar"; fail "the imported account's bcrypt password was refused ($(status_of "$r"))"; return 1; }
  session_has "$jar" "$PROOF_EMAIL" || { rm -f "$jar"; fail "the session did not read back"; return 1; }
  ak "$jar" /sign-out '{}' >/dev/null
  ! session_has "$jar" "$PROOF_EMAIL" || { rm -f "$jar"; fail "sign-out did not end the session"; return 1; }
  rm -f "$jar"
  echo "proof: an imported account (bcrypt, written before the import) refused a wrong password, signed in, read its session, signed out"
}

# AccountKit's own screens: a new person, start to finish.
prove_journey() {
  local jar r
  jar="$(mktemp)"
  r="$(ak "$jar" /sign-up/email "{\"email\":\"$SIGNUP_EMAIL\",\"password\":\"$SIGNUP_PASSWORD\",\"name\":\"AccountKit proof\"}")"
  [ "$(status_of "$r")" = 200 ] || { rm -f "$jar"; fail "sign-up refused ($(status_of "$r"))"; return 1; }
  session_has "$jar" "$SIGNUP_EMAIL" || { rm -f "$jar"; fail "sign-up did not sign the person in"; return 1; }
  echo "journey: signed up, signed in at once"
  ak "$jar" /sign-out '{}' >/dev/null
  ! session_has "$jar" "$SIGNUP_EMAIL" || { rm -f "$jar"; fail "sign-out did not end the session"; return 1; }
  echo "journey: signed out"
  r="$(ak "$jar" /sign-in/email "{\"email\":\"$SIGNUP_EMAIL\",\"password\":\"wrong-$(openssl rand -hex 6)\"}")"
  [ "$(status_of "$r")" != 200 ] || { rm -f "$jar"; fail "a wrong password signed in"; return 1; }
  echo "journey: a wrong password is refused"
  r="$(ak "$jar" /sign-in/email "{\"email\":\"$SIGNUP_EMAIL\",\"password\":\"$SIGNUP_PASSWORD\"}")"
  [ "$(status_of "$r")" = 200 ] && session_has "$jar" "$SIGNUP_EMAIL" || { rm -f "$jar"; fail "signing in again was refused"; return 1; }
  echo "journey: signed in with the right password"
  r="$(ak "$jar" /delete-user "{\"password\":\"$SIGNUP_PASSWORD\"}")"
  [ "$(status_of "$r")" = 200 ] || { rm -f "$jar"; fail "deleting the account was refused ($(status_of "$r"))"; return 1; }
  ! session_has "$jar" "$SIGNUP_EMAIL" || { rm -f "$jar"; fail "deleting the account did not end its session"; return 1; }
  [ "$(q -c "SELECT count(*) FROM $SHARED_USERS WHERE email = '$SIGNUP_EMAIL'")" = 0 ] && [ "$(product_rows "$SIGNUP_EMAIL")" = 0 ] \
    || { rm -f "$jar"; fail "the deleted account left rows behind"; return 1; }
  rm -f "$jar"
  echo "journey: deleted; no row of the person remains"
}

rollback() {
  local only
  only="$(native_only)"
  set_runtime ""
  restart
  echo "rolled back: AUTH_RUNTIME emptied, $UNIT restarted on its legacy sign-in; no table emptied"
  [ "${only:-0}" = 0 ] || echo "note: $only credential(s) set through AccountKit are kept in the shared tables, unused until the next switch"
}

case "$ACTION" in
  survey) survey ;;
  rehearse) rehearse ;;
  rollback) rollback ;;
  prove)
    case "$(value AUTH_RUNTIME)" in accountkit) ;; *) echo "$APP is not switched; nothing to prove"; exit 1 ;; esac
    trap 'proof_delete "$SIGNUP_EMAIL"' EXIT
    prove_journey
    ;;
  switch)
    s="$(survey)"; echo "$s"
    case "$s" in *runtime=accountkit*) echo "$APP already runs on AccountKit; nothing to do"; exit 0 ;; esac
    # A way in that works today must work after: a configured Google client
    # with people who sign in only through it.
    google_only="$(grep -oE 'google_only=[0-9]+' <<< "$s" | cut -d= -f2 || true)"
    if grep -q 'google_client=set' <<< "$s" && [ "${google_only:-0}" != 0 ]; then
      echo "refused: Google is configured here and $google_only people sign in only through it"; exit 1
    fi
    roles_before="$(q -c "$ROLES_SQL")"

    # 1. A backup made now, restored and rehearsed before anything changes.
    dump="$(dump_now preswitch)"
    echo "backup: $(basename "$dump") ($(sudo du -h "$dump" | cut -f1), mode $(sudo stat -c %a "$dump"))"
    rehearse_from "$dump" || { echo "refused: the rehearsal on the fresh backup failed; nothing changed"; exit 1; }

    # 2. The throwaway legacy account, written as the product's writers did.
    proof_insert || { echo "could not write the proof account; nothing changed"; exit 1; }
    trap 'proof_delete "$PROOF_EMAIL"' EXIT

    # AccountKit needs a session secret of at least 32 characters.
    if [ "$(value BETTER_AUTH_SECRET | wc -c)" -le 32 ]; then
      sudo sed -i -E '/^(export[[:space:]]+)?BETTER_AUTH_SECRET=/d' "$ENVF"
      printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)" | sudo tee -a "$ENVF" >/dev/null
      sudo chmod 600 "$ENVF"
      echo "BETTER_AUTH_SECRET: added"
    fi

    # 3. Legacy writes stop for the import: the app is down for its seconds.
    sudo systemctl stop "$UNIT"
    if ! printf '%s\n' "SET lock_timeout = '10s';" "$IMPORT_SQL" | q -1 >/dev/null 2>&1; then
      echo "import failed; rolled back by its transaction. Starting $UNIT unchanged"
      sudo systemctl start "$UNIT"; healthy || true
      exit 1
    fi
    echo "import: committed ($(q -c "SELECT count(*) FROM $SHARED_USERS") shared accounts, 1 of them the proof account)"
    set_runtime accountkit
    sudo systemctl start "$UNIT"
    healthy || { echo "start failed; rolling back"; rollback; exit 1; }

    # 4. Proof on the public site, and nothing about who may do what moved.
    if ! prove_imported; then echo "proof failed; rolling back"; rollback; exit 1; fi
    [ "$(q -c "$ROLES_SQL")" = "$roles_before" ] || { echo "roles changed; rolling back"; rollback; exit 1; }
    echo "roles: unchanged (digest $roles_before)"
    echo "switched: $APP runs on AccountKit"
    ;;
esac
REMOTE
} | "${SSH[@]}" "$BOX" 'bash -s'
