#!/usr/bin/env bash
# Tests for app-secrets.sh, its remote half run locally (no box, no network).
#
# What must hold, because the values are ones nobody can recover:
#   - a value already in a file is never replaced, on any re-run;
#   - a pair (morulia's SIGNIN_CLIENT_SECRET_<ID> = the app's SIGNIN_CLIENT_SECRET)
#     ends up EQUAL in both files, whichever side had it first;
#   - two different values are reported, never "fixed";
#   - no value is ever printed;
#   - an OrangeCat client (oc-client) ends with the app's secret and the row's
#     sha256 agreeing, and a row that holds a secret the app lacks is left alone;
#   - signin-on refuses while Morulia has no provider, and then only adds
#     SIGNIN_ISSUER and SIGNIN_CLIENT_ID beside a secret that is already there,
#     and never in an app whose AccountKit names a fixed list of providers.
#
# `ssh` and `systemctl` are stubbed on PATH: ssh runs the heredoc with local
# bash, and APP_SECRETS_OPT points the remote half at a temp dir for /opt.
# `docker` is a fake OrangeCat oauth_clients table (one line per row:
# id|sha256|on), and `curl` answers Morulia's /api/health from a file.
#
# Run: bash scripts/hetzner/test-app-secrets.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }

mkdir -p "$TMP/bin"
printf '#!/usr/bin/env bash\nexec bash -s\n' > "$TMP/bin/ssh"
printf '#!/usr/bin/env bash\nexit 1\n' > "$TMP/bin/systemctl"   # no units yet
chmod +x "$TMP/bin/ssh" "$TMP/bin/systemctl"
OCDB="$TMP/oauth_clients"; : > "$OCDB"
HEALTH="$TMP/health.json"; echo '{"ok":true,"providers":[]}' > "$HEALTH"
cat > "$TMP/bin/docker" <<STUB
#!/usr/bin/env bash
# docker exec -i <container> psql ... ; the SQL arrives on stdin.
sql="\$(cat)"
id="\$(grep -oE "client_id = '[a-z0-9-]+'" <<<"\$sql" | head -n 1 | cut -d"'" -f2)"
line="\$(grep -E "^\$id\\|" "$OCDB" || true)"
case "\$sql" in
  SELECT*) [ -n "\$line" ] && { IFS='|' read -r _ h on <<<"\$line"; echo "\$h|\$on"; } ;;
  UPDATE*)
    want="\$(grep -oE "client_secret_hash = '[0-9a-f]{64}'" <<<"\$sql" | head -n 1 | cut -d"'" -f2)"
    IFS='|' read -r _ h on <<<"\$line"
    if [ -n "\$line" ] && { [ -z "\$h" ] || [ "\$h" = "\$want" ]; }; then
      grep -vE "^\$id\\|" "$OCDB" > "$OCDB.new" || true
      echo "\$id|\$want|true" >> "$OCDB.new"; mv "$OCDB.new" "$OCDB"; echo "\$id"
    fi ;;
esac
exit 0
STUB
printf '#!/usr/bin/env bash\ncat "%s"\n' "$HEALTH" > "$TMP/bin/curl"
chmod +x "$TMP/bin/docker" "$TMP/bin/curl"

OPT="$TMP/opt"
run() { PATH="$TMP/bin:$PATH" APP_SECRETS_OPT="$OPT" bash "$HERE/app-secrets.sh" "$@" 2>&1; }
val() { grep -E "^$1=" "$2" | tail -n 1 | cut -d= -f2-; }
count() { grep -cE "^$1=" "$2" || true; }

S="$OPT/morulia/shared/.env"
for a in morulia causius diplodoctor heidi revamp-info solon substrata; do
  mkdir -p "$OPT/$a/shared"; : > "$OPT/$a/shared/.env"
done
# biaslens has no env on this "box": its pair must be skipped, not half-written.
# heidi already holds a client secret; solon holds one that disagrees with morulia.
echo "SIGNIN_CLIENT_SECRET=heidi-existing-value-0123456789abcdef0123" >> "$OPT/heidi/shared/.env"
echo "SIGNIN_CLIENT_SECRET=solon-side-value-0123456789abcdef01234567" >> "$OPT/solon/shared/.env"
echo "SIGNIN_CLIENT_SECRET_SOLON=morulia-side-value-0123456789abcdef012345" >> "$S"
echo "BETTER_AUTH_SECRET=from-provision-db-0123456789abcdef0123456789" >> "$S"

OUT="$(run ensure morulia)" || fail "ensure morulia failed: $OUT"

[ "$(val SIGNIN_URL "$S")" = "https://morulia.orangecat.ch" ] && ok "SIGNIN_URL is the issuer, no trailing slash" || fail "SIGNIN_URL: $(val SIGNIN_URL "$S")"
[ "$(val BETTER_AUTH_SECRET "$S")" = "from-provision-db-0123456789abcdef0123456789" ] && [ "$(count BETTER_AUTH_SECRET "$S")" = 1 ] \
  && ok "an existing BETTER_AUTH_SECRET is kept, not duplicated" || fail "BETTER_AUTH_SECRET was touched"
[[ "$(val SIGNIN_PAIRWISE_SECRET "$S")" =~ ^[0-9a-f]{64}$ ]] && ok "SIGNIN_PAIRWISE_SECRET generated (64 hex)" || fail "no pairwise secret"

c="$(val SIGNIN_CLIENT_SECRET_CAUSIUS "$S")"
[[ "$c" =~ ^[0-9a-f]{64}$ ]] && [ "$c" = "$(val SIGNIN_CLIENT_SECRET "$OPT/causius/shared/.env")" ] \
  && ok "neither side set: one value, written to both" || fail "causius pair differs"
[ "$(val SIGNIN_CLIENT_SECRET_HIRNLI "$S")" = "$(val SIGNIN_CLIENT_SECRET "$OPT/revamp-info/shared/.env")" ] \
  && ok "the hirnli client's secret lands in revamp-info's env" || fail "hirnli pair differs"
[ "$(val SIGNIN_CLIENT_SECRET_HEIDI "$S")" = "heidi-existing-value-0123456789abcdef0123" ] \
  && [ "$(count SIGNIN_CLIENT_SECRET "$OPT/heidi/shared/.env")" = 1 ] \
  && ok "only the app had it: copied to morulia, the app's value untouched" || fail "heidi pair wrong"
[ "$(val SIGNIN_CLIENT_SECRET_SOLON "$S")" = "morulia-side-value-0123456789abcdef012345" ] \
  && [ "$(val SIGNIN_CLIENT_SECRET "$OPT/solon/shared/.env")" = "solon-side-value-0123456789abcdef01234567" ] \
  && grep -q "SIGNIN_CLIENT_SECRET_SOLON = solon SIGNIN_CLIENT_SECRET: MISMATCH" <<<"$OUT" \
  && ok "two different values: reported as MISMATCH, neither changed" || fail "solon mismatch handling: $OUT"
! grep -q "SIGNIN_CLIENT_SECRET_BIASLENS" "$S" && grep -q "biaslens has no env file on the box — pair skipped" <<<"$OUT" \
  && ok "an app with no env on the box: skipped, nothing written to either side" || fail "biaslens: $OUT"
grep -q "morulia-app is not running" <<<"$OUT" && ok "no unit yet: says so instead of failing the restart" || fail "restart: $OUT"

# Nothing that was written may appear in the output.
leaked=""
for f in "$OPT"/*/shared/.env; do
  while IFS= read -r line; do
    v="${line#*=}"
    [ "${#v}" -ge 16 ] && [[ "$v" != https://* ]] && grep -qF -- "$v" <<<"$OUT" && leaked="$leaked ${line%%=*}"
  done < "$f"
done
[ -z "$leaked" ] && ok "no secret value appears in the output" || fail "printed:$leaked"

# A second run changes nothing.
before="$(cat "$OPT"/*/shared/.env | sha256sum)"
OUT2="$(run ensure morulia)" || fail "second ensure failed: $OUT2"
[ "$before" = "$(cat "$OPT"/*/shared/.env | sha256sum)" ] && ok "a re-run writes nothing" || fail "a re-run changed a file"
grep -q "nothing to add for morulia" <<<"$OUT2" && ok "a re-run says there was nothing to add" || fail "$OUT2"

# show only reads.
OUT3="$(run show morulia)" || fail "show failed"
[ "$before" = "$(cat "$OPT"/*/shared/.env | sha256sum)" ] && grep -q "SIGNIN_PAIRWISE_SECRET *set" <<<"$OUT3" \
  && ok "show reports set/not set and writes nothing" || fail "show: $OUT3"

# The existing apps are unchanged by the new kind.
OUT4="$(run ensure heidi)" || fail "ensure heidi failed: $OUT4"
grep -qE "^CRON_SECRET=[0-9a-f]{64}$" "$OPT/heidi/shared/.env" && grep -qE "^VAPID_PUBLIC_KEY=.+" "$OPT/heidi/shared/.env" \
  && ok "heidi's rows still work (hex32, vapid)" || fail "heidi: $OUT4"

# ── oc-client: "Sign in with OrangeCat" for an app that had no client ───────
sha() { printf %s "$1" | sha256sum | cut -d' ' -f1; }
for a in biaslens diplodoctor kivvi; do mkdir -p "$OPT/$a/shared"; : > "$OPT/$a/shared/.env"; done
echo "biaslens||false" >> "$OCDB"                       # created by orangecat's deploy, no secret
echo "diplodoctor|$(sha someone-elses-secret)|true" >> "$OCDB"   # registered by hand earlier
echo "hirnli||false" >> "$OCDB"
echo "ORANGECAT_OAUTH_CLIENT_SECRET=revamp-info-held-0123456789abcdef0123456" >> "$OPT/revamp-info/shared/.env"

OUT5="$(run ensure biaslens)" || fail "ensure biaslens failed: $OUT5"
B="$OPT/biaslens/shared/.env"
bs="$(val ORANGECAT_OAUTH_CLIENT_SECRET "$B")"
[[ "$bs" =~ ^[0-9a-f]{64}$ ]] && [ "$(val ORANGECAT_OAUTH_CLIENT_ID "$B")" = biaslens ] \
  && grep -qxF "biaslens|$(sha "$bs")|true" "$OCDB" \
  && ok "oc-client: the app gets id + secret, OrangeCat the secret's sha256, switched on" || fail "biaslens: $OUT5 / $(cat "$OCDB")"
! grep -qF "$bs" <<<"$OUT5" && ! grep -qF "$(sha "$bs")" <<<"$OUT5" \
  && ok "oc-client: neither the secret nor its hash is printed" || fail "biaslens printed a value"
before5="$(cat "$B" "$OCDB" | sha256sum)"
OUT6="$(run ensure biaslens)" || fail "second ensure biaslens failed: $OUT6"
[ "$before5" = "$(cat "$B" "$OCDB" | sha256sum)" ] && grep -q "kept (app and OrangeCat agree" <<<"$OUT6" \
  && ok "oc-client: a re-run keeps both sides as they are" || fail "biaslens re-run: $OUT6"

OUT7="$(run ensure diplodoctor)" || fail "ensure diplodoctor failed: $OUT7"
! grep -q ORANGECAT_OAUTH "$OPT/diplodoctor/shared/.env" && grep -qxF "diplodoctor|$(sha someone-elses-secret)|true" "$OCDB" \
  && grep -q "holds a secret this app lacks — left alone" <<<"$OUT7" \
  && ok "oc-client: a row with a secret the app lacks is reported, nothing written" || fail "diplodoctor: $OUT7"

OUT8="$(run ensure kivvi)" || fail "ensure kivvi failed: $OUT8"
[ ! -s "$OPT/kivvi/shared/.env" ] && grep -q "no such row in OrangeCat yet" <<<"$OUT8" \
  && ok "oc-client: no row yet — nothing written to the app either" || fail "kivvi: $OUT8"

OUT9="$(run ensure revamp-info)" || fail "ensure revamp-info failed: $OUT9"
grep -qxF "hirnli|$(sha revamp-info-held-0123456789abcdef0123456)|true" "$OCDB" \
  && [ "$(val ORANGECAT_OAUTH_CLIENT_ID "$OPT/revamp-info/shared/.env")" = hirnli ] \
  && [ "$(count ORANGECAT_OAUTH_CLIENT_SECRET "$OPT/revamp-info/shared/.env")" = 1 ] \
  && ok "oc-client: the app's existing secret is copied into the row (client hirnli, box revamp-info)" || fail "revamp-info: $OUT9"

# ── signin-on: the button, only once Morulia has a provider ─────────────────
before10="$(cat "$OPT"/*/shared/.env | sha256sum)"
OUT10="$(run signin-on heidi)" && fail "signin-on ran with no provider: $OUT10"
[ "$before10" = "$(cat "$OPT"/*/shared/.env | sha256sum)" ] && grep -q "has no provider switched on yet" <<<"$OUT10" \
  && ok "signin-on: refused while Morulia lists no provider, nothing written" || fail "signin-on no provider: $OUT10"

echo '{"ok":true,"providers":["google","github"]}' > "$HEALTH"
# causius runs an AccountKit whose button names a fixed list of providers;
# heidi one that names only what Morulia publishes (the oldest copy in a
# release decides); the other apps have no release on this "box" at all.
ak() { mkdir -p "$OPT/$1/app/$2/@bitbaum/accountkit"; printf '{"name":"@bitbaum/accountkit","version":"%s"}\n' "$3" > "$OPT/$1/app/$2/@bitbaum/accountkit/package.json"; }
ak causius node_modules 0.23.1
ak heidi node_modules 0.24.0
ak heidi node_modules/.pnpm/x/node_modules 0.24.2
OUT11="$(run signin-on all)" || fail "signin-on all failed: $OUT11"
! grep -q SIGNIN_ISSUER "$OPT/causius/shared/.env" && grep -q "causius: runs AccountKit 0.23.1" <<<"$OUT11" \
  && ok "signin-on: an app on an AccountKit that names fixed providers waits, nothing written" || fail "signin-on causius: $OUT11"
[ "$(val SIGNIN_CLIENT_ID "$OPT/heidi/shared/.env")" = heidi ] \
  && ok "signin-on: an app on AccountKit 0.24 or later is switched on" || fail "signin-on heidi: $OUT11"
ak substrata node_modules 0.24.0
ak substrata node_modules/.pnpm/y/node_modules 0.19.0
OUT11b="$(run signin-on substrata)" || fail "signin-on substrata failed: $OUT11b"
grep -q "substrata: runs AccountKit 0.19.0" <<<"$OUT11b" \
  && ok "signin-on: an older copy anywhere in the release holds the app back" || fail "signin-on substrata: $OUT11b"
H="$OPT/heidi/shared/.env"
[ "$(val SIGNIN_ISSUER "$H")" = "https://morulia.orangecat.ch" ] && [ "$(val SIGNIN_CLIENT_ID "$H")" = heidi ] \
  && [ "$(val SIGNIN_CLIENT_ID "$OPT/revamp-info/shared/.env")" = hirnli ] \
  && ok "signin-on all: issuer and client id beside each paired secret (hirnli on revamp-info)" || fail "signin-on: $OUT11"
! grep -q SIGNIN_ISSUER "$OPT/kivvi/shared/.env" && grep -q "kivvi: no SIGNIN_CLIENT_SECRET yet" <<<"$OUT11" \
  && ok "signin-on: an app without its secret is skipped, nothing written" || fail "signin-on kivvi: $OUT11"
before12="$(cat "$OPT"/*/shared/.env | sha256sum)"
OUT12="$(run signin-on heidi)" || fail "second signin-on failed: $OUT12"
[ "$before12" = "$(cat "$OPT"/*/shared/.env | sha256sum)" ] && grep -q "heidi: SIGNIN_CLIENT_ID kept" <<<"$OUT12" \
  && ok "signin-on: a re-run writes nothing" || fail "signin-on re-run: $OUT12"
OUT13="$(run signin-on nosuchapp)" && fail "signin-on accepted an unknown app"
grep -q "nosuchapp: not a Morulia client" <<<"$OUT13" && ok "signin-on: an app that is not a client is refused" || fail "$OUT13"

# Only signin-on may switch the shared sign-in on: a fixed SIGNIN_ISSUER or
# SIGNIN_CLIENT_ID row would be written by any `ensure`, button and all, while
# Morulia may still have no provider (loki #1531, undone).
! grep -qE "^[a-z0-9-]+\|SIGNIN_(ISSUER|CLIENT_ID)\|" "$HERE/app-secrets.sh" \
  && ok "no registry row sets SIGNIN_ISSUER or SIGNIN_CLIENT_ID; only signin-on does" \
  || fail "a registry row sets SIGNIN_ISSUER/SIGNIN_CLIENT_ID; use signin-on"

# A unit that exists but is not running (registered, never deployed: keller on
# 2026-11-01) is not restarted, so the run does not fail on it.
cat > "$TMP/bin/systemctl" <<STUB
#!/usr/bin/env bash
case "\$1" in
  cat) exit 0 ;;
  is-active) exit 3 ;;
  restart) echo restarted >> "$TMP/restarts"; exit 1 ;;
esac
exit 1
STUB
sed -i '/^CRON_SECRET=/d' "$OPT/heidi/shared/.env"
OUT14="$(run ensure heidi)" || fail "ensure on a stopped unit failed: $OUT14"
[ ! -e "$TMP/restarts" ] && grep -q "heidi-app is not running" <<<"$OUT14" \
  && ok "a unit that is not running is left alone, and the run succeeds" || fail "stopped unit: $OUT14"

# ── lightning-on: one flag, only where AccountKit 0.26.1+ runs ──────────────
rm -f "$TMP/restarts"
ak diplodoctor node_modules 0.26.1
ak solon node_modules 0.26.1
echo "ACCOUNTKIT_LIGHTNING=0" >> "$OPT/solon/shared/.env"
OUT15="$(run lightning-on all)" || fail "lightning-on all failed: $OUT15"
[ "$(count ACCOUNTKIT_LIGHTNING "$OPT/diplodoctor/shared/.env")" = 1 ] && [ "$(val ACCOUNTKIT_LIGHTNING "$OPT/diplodoctor/shared/.env")" = 1 ] \
  && ok "lightning-on all: an app on AccountKit 0.26.1 gets ACCOUNTKIT_LIGHTNING=1 once" || fail "lightning-on diplodoctor: $OUT15"
! grep -q ACCOUNTKIT_LIGHTNING "$OPT/heidi/shared/.env" && grep -q "heidi: runs AccountKit 0.24.0 — waits for 0.26.1" <<<"$OUT15" \
  && ok "lightning-on: an older AccountKit waits, nothing written" || fail "lightning-on heidi: $OUT15"
[ "$(val ACCOUNTKIT_LIGHTNING "$OPT/solon/shared/.env")" = 0 ] && grep -q "solon: ACCOUNTKIT_LIGHTNING already set — kept" <<<"$OUT15" \
  && ok "lightning-on: a value someone set is kept" || fail "lightning-on solon: $OUT15"
! grep -q "morulia:" <<<"$OUT15" \
  && ok "lightning-on all: apps without AccountKit in their release are not touched" || fail "lightning-on morulia: $OUT15"
# A standalone release with no accountkit package.json: its receipt decides.
mkdir -p "$OPT/kivvi/app/public/.well-known" "$OPT/kivvi/shared"; : > "$OPT/kivvi/shared/.env"
printf '{"artifacts":{"@bitbaum/accountkit":"0.27.0"}}\n' > "$OPT/kivvi/app/public/.well-known/fleet-release.json"
OUT17="$(run lightning-on kivvi)" || fail "lightning-on kivvi failed: $OUT17"
[ "$(val ACCOUNTKIT_LIGHTNING "$OPT/kivvi/shared/.env")" = 1 ] \
  && ok "lightning-on: a standalone release is read from its receipt" || fail "lightning-on receipt: $OUT17"
OUT16="$(run lightning-on diplodoctor)" || fail "lightning-on again failed: $OUT16"
[ "$(count ACCOUNTKIT_LIGHTNING "$OPT/diplodoctor/shared/.env")" = 1 ] && grep -q "already set" <<<"$OUT16" \
  && ok "lightning-on: running it again changes nothing" || fail "lightning-on again: $OUT16"

OUT18="$(run lightning-off diplodoctor)" || fail "lightning-off failed: $OUT18"
! grep -q ACCOUNTKIT_LIGHTNING "$OPT/diplodoctor/shared/.env" && grep -q "ACCOUNTKIT_LIGHTNING removed" <<<"$OUT18" \
  && ok "lightning-off removes the flag from one app" || fail "lightning-off: $OUT18"
OUT19="$(run lightning-off all)" && fail "lightning-off all ran: $OUT19"
grep -q "takes one app" <<<"$OUT19" && ok "lightning-off refuses all" || fail "lightning-off all: $OUT19"

echo "app-secrets: $PASSED passed"
