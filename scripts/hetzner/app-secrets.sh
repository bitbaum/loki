#!/usr/bin/env bash
# app-secrets.sh — the secrets an app needs that NO HUMAN HOLDS, written into
# the app's env on the box: a cron bearer token, a Web Push (VAPID) key pair.
#
# WHY
# ---
# An app's .env on the box is the runtime SSOT (selfhost-deploy.yml pulls it from
# there; nothing in GitHub holds it). Keys from a vendor are pasted in by a
# person once. But some values have no vendor and no person: CRON_SECRET is a
# token the box's own timer presents to the app, and a VAPID pair is two random
# EC keys the browser and the server agree on. Asking the owner to "generate and
# paste" those is asking them to run openssl for a value nobody will ever read.
# On 2026-10-22 heidi shipped channel notifications and the owner, rightly,
# declined to do exactly that. This script does it, from GitHub, over the same
# SSH the deploy uses (.github/workflows/app-secrets.yml).
#
# RULES
# - Adds only what is MISSING. Never overwrites a key already in the file —
#   rotating a secret is a deliberate edit, not a side effect of a re-run.
# - Prints names and set/not-set, never a value. The workflow's log is public.
# - A VAPID pair is one unit: both keys or neither. Half a pair is reported,
#   not patched — the browsers already subscribed hold the old public key.
# - Restarts <app>-app only when something was added to ITS file and the unit
#   is RUNNING (launch.sh sources .env at start; nothing is baked into the
#   build). A unit that exists but is not running is left alone: an app that
#   is registered but was never deployed (keller, 2026-11-01) has a unit and
#   no release, so restarting it only fails the run. Its next start, the
#   first deploy, reads the new values.
# - A pair is one value in TWO apps' env files (a client secret both ends of an
#   OIDC client must hold). Generated once, written to both; when only one side
#   has it, it is copied ON THE BOX to the other, so the value never travels or
#   prints; when both have different values it is reported, never "fixed" —
#   which side is right is a decision. The other app is not restarted: its copy
#   takes effect at its next start.
#
# REGISTRY: app|VAR|kind — mirror of what each app reads from process.env.
#   hex32            64 hex characters (openssl rand)
#   vapid            VAR is the prefix: VAR_PUBLIC_KEY + VAR_PRIVATE_KEY, P-256
#   literal:<value>  a constant (a mailto: subject, say)
#   pair:<app2>:<VAR2>  hex32, the same value as <VAR2> in <app2>'s env
#                       (<app2> is the box name, /opt/<app2>)
#   oc-client:<id>   "Sign in with OrangeCat" for this app: VAR is the prefix,
#                    VAR_ID=<id> and VAR_SECRET=hex32 in the app's env, and the
#                    secret's sha256 in OrangeCat's public.oauth_clients row
#                    <id> (the hash is all OrangeCat keeps; register-client.ts
#                    stores it the same way). The row comes from orangecat
#                    scripts/oauth/client-specs.ts, created switched off and
#                    without a secret by orangecat's deploy; this enables it.
#                    The app's env is written FIRST, so a failure between the
#                    two leaves the app holding a secret the next run copies
#                    into the row, never a row nobody can match. A row that
#                    already holds a secret this app lacks is reported, never
#                    replaced: rotating is register-client.ts --rotate, by hand.
#
# Usage (from a laptop or the workflow; needs ssh to the box as ubuntu):
#   bash scripts/hetzner/app-secrets.sh show   heidi
#   bash scripts/hetzner/app-secrets.sh ensure heidi
#   bash scripts/hetzner/app-secrets.sh signin-on heidi   # or: signin-on all
#   bash scripts/hetzner/app-secrets.sh lightning-on biaslens   # or: lightning-on all
#
# lightning-on turns on Lightning login (LNURL-auth, AccountKit 0.26.1+:
# ACCOUNTKIT_LIGHTNING=1) in one app, or in every app on the box whose running
# release carries AccountKit (`all`). Free, no key, no third party, so there
# is nothing to pair. An app whose oldest AccountKit copy predates
# LIGHTNING_MIN_ACCOUNTKIT waits (the flag would mount nothing, or a broken
# client type); the next run after its bump switches it on.
#
# signin-on turns the shared sign-in's button on in an app (accountkit shows
# "Continue with <the providers Morulia publishes>" once SIGNIN_ISSUER,
# SIGNIN_CLIENT_ID and SIGNIN_CLIENT_SECRET are all set). It adds the first
# two beside the secret `ensure morulia` paired, and restarts the app. It
# REFUSES while Morulia's /api/health lists no provider: a button that leads
# to a page with no provider on it is worse than no button. It also skips an
# app whose AccountKit predates SIGNIN_MIN_ACCOUNTKIT, whose button would name
# a fixed list of providers. Re-running is safe: what is set is kept. The client id is
# read from the morulia pair rows below, so there is one list, not two.
# Rolling back is a deliberate edit of the app's env, like any rotation.
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_UBUNTU

ACTION="${1:?usage: app-secrets.sh show|ensure|signin-on|lightning-on <app>}"
APP="${2:?usage: app-secrets.sh show|ensure|signin-on|lightning-on <app>}"
case "$ACTION" in show|ensure|signin-on|lightning-on) ;; *) echo "unknown action: $ACTION (show|ensure|signin-on|lightning-on)" >&2; exit 2 ;; esac
case "$APP" in *[!a-z0-9-]*|"") echo "app name must be [a-z0-9-]: $APP" >&2; exit 2 ;; esac

REGISTRY="$(cat <<'REG'
# heidi: the hourly channel sweep (install-app-crons.sh row) presents
# CRON_SECRET; VAPID_* turns Web Push on (heidi lib/push/send.ts). The subject
# is the site's contact address (heidi lib/config/site.ts CONTACT_EMAIL).
heidi|CRON_SECRET|hex32
heidi|VAPID|vapid
heidi|VAPID_SUBJECT|literal:mailto:cato@orangecat.ch
# morulia: the shared sign-in (bitbaum/morulia .env.example; first named signin). SIGNIN_URL is the
# OIDC issuer, byte for byte, so no trailing slash. SIGNIN_PAIRWISE_SECRET
# derives every person's subject in every app: it is NEVER rotated, and this
# script never overwrites a value — that rule is what makes it safe here.
# BETTER_AUTH_SECRET may already be there from provision-db-on-box.sh; then it
# is kept.
morulia|SIGNIN_URL|literal:https://morulia.orangecat.ch
morulia|BETTER_AUTH_SECRET|hex32
morulia|SIGNIN_PAIRWISE_SECRET|hex32
# One row per client in bitbaum/morulia lib/clients.ts: SIGNIN_CLIENT_SECRET_<ID>
# here equals SIGNIN_CLIENT_SECRET in that app. The hirnli client is served by
# the revamp-info app (apps.conf), so its env is /opt/revamp-info. The secret
# alone switches nothing on in an app: accountkit shows the button only once
# SIGNIN_ISSUER and SIGNIN_CLIENT_ID are set too.
morulia|SIGNIN_CLIENT_SECRET_BIASLENS|pair:biaslens:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_CAUSIUS|pair:causius:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_DIPLODOCTOR|pair:diplodoctor:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_HEIDI|pair:heidi:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_HIRNLI|pair:revamp-info:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_PETVITY|pair:petvity:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_SOLON|pair:solon:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_SUBSTRATA|pair:substrata:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_SURF_YOUR_LIFE|pair:surf-your-life:SIGNIN_CLIENT_SECRET
# 2026-11-01: every other fleet app with a sign-in page (fleet
# docs/auth-parity-2026-11-01.md), whatever its runtime, so the secret is in
# place before the app wires the button. Box names are apps.conf's: AOZ is
# aoz-wohnen, DataCat datacat-web; loki's env is /opt/loki/app/.env.
morulia|SIGNIN_CLIENT_SECRET_AOZ_BEGLEITUNG|pair:aoz-wohnen:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_BOTSMANN|pair:botsmann:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_DATACAT|pair:datacat-web:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_EVIG|pair:evig:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_KELLER|pair:keller:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_KIVVI|pair:kivvi:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_LOKI|pair:loki:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_PRINTCRAFT|pair:printcraft:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_REPARATURBONUS_ZH|pair:reparaturbonus-zh:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_SKIF|pair:skif:SIGNIN_CLIENT_SECRET
morulia|SIGNIN_CLIENT_SECRET_VITAREBA|pair:vitareba:SIGNIN_CLIENT_SECRET
# "Sign in with OrangeCat" for the apps that had no OrangeCat client
# (orangecat scripts/oauth/client-specs.ts holds the rows). The hirnli client
# is served by revamp-info, as above; AOZ's box name is aoz-wohnen.
aoz-wohnen|ORANGECAT_OAUTH_CLIENT|oc-client:aoz-begleitung
biaslens|ORANGECAT_OAUTH_CLIENT|oc-client:biaslens
botsmann|ORANGECAT_OAUTH_CLIENT|oc-client:botsmann
diplodoctor|ORANGECAT_OAUTH_CLIENT|oc-client:diplodoctor
keller|ORANGECAT_OAUTH_CLIENT|oc-client:keller
kivvi|ORANGECAT_OAUTH_CLIENT|oc-client:kivvi
printcraft|ORANGECAT_OAUTH_CLIENT|oc-client:printcraft
reparaturbonus-zh|ORANGECAT_OAUTH_CLIENT|oc-client:reparaturbonus-zh
revamp-info|ORANGECAT_OAUTH_CLIENT|oc-client:hirnli
vitareba|ORANGECAT_OAUTH_CLIENT|oc-client:vitareba
REG
)"

# signin-on: the morulia pair rows are the list of clients. SIGNIN_CLIENT_SECRET_<ID>
# names the client id (lowercase, _ for -), the pair's peer is the box app.
signin_client_of() {  # never fails: no row prints nothing
  { grep -E "^morulia\|SIGNIN_CLIENT_SECRET_[A-Z0-9_]+\|pair:$1:SIGNIN_CLIENT_SECRET\$" <<< "$REGISTRY" \
    || true; } | head -n 1 | cut -d'|' -f2 | sed 's/^SIGNIN_CLIENT_SECRET_//' | tr 'A-Z_' 'a-z-'
}
# The first AccountKit whose button names only the providers Morulia publishes
# (bitbaum/accountkit, "signinProviders"). signin-on leaves an app on an older
# one alone.
SIGNIN_MIN_ACCOUNTKIT="0.24.0"
if [ "$ACTION" = signin-on ]; then
  issuer="$(grep -E '^morulia\|SIGNIN_URL\|literal:' <<< "$REGISTRY" | cut -d'|' -f3)"
  issuer="${issuer#literal:}"
  # The health check names the providers that are switched on (names only).
  providers="$(curl -fsS --max-time 20 "$issuer/api/health" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).providers;process.stdout.write(Array.isArray(p)?p.join(","):"")})')" \
    || { echo "could not read $issuer/api/health — nothing changed" >&2; exit 1; }
  if [ -z "$providers" ]; then
    echo "Morulia has no provider switched on yet ($issuer/api/health lists none)." >&2
    echo "The button would lead to a page with nothing on it — refused, nothing changed." >&2
    exit 1
  fi
  echo "Morulia providers on: $providers"
  if [ "$APP" = all ]; then
    targets="$(grep -oE "\|pair:[a-z0-9-]+:SIGNIN_CLIENT_SECRET\$" <<< "$REGISTRY" | cut -d: -f2)"
  else
    targets="$APP"
  fi
  failed=0
  for target in $targets; do
    client="$(signin_client_of "$target")"
    if [ -z "$client" ]; then
      echo "$target: not a Morulia client (no morulia pair row here, nor in bitbaum/morulia lib/clients.ts)" >&2
      failed=1; continue
    fi
    ssh -o BatchMode=yes "$BOX_UBUNTU" 'bash -s' <<REMOTE || failed=1
set -euo pipefail
OPT=$(printf %q "${APP_SECRETS_OPT:-/opt}")
APP=$(printf %q "$target")
ISSUER=$(printf %q "$issuer")
CLIENT=$(printf %q "$client")
MIN_AK=$(printf %q "$SIGNIN_MIN_ACCOUNTKIT")
ENVF=""
for cand in "\$OPT/\$APP/shared/.env" "\$OPT/\$APP/app/.env"; do [ -f "\$cand" ] && { ENVF="\$cand"; break; }; done
[ -n "\$ENVF" ] || { echo "\$APP: no env file on the box — nothing written"; exit 0; }
has() { grep -qE "^(export[[:space:]]+)?\$1=.+" "\$ENVF"; }
value() { grep -E "^(export[[:space:]]+)?\$1=" "\$ENVF" | tail -n 1 | cut -d= -f2-; }
if ! has SIGNIN_CLIENT_SECRET; then
  echo "\$APP: no SIGNIN_CLIENT_SECRET yet — run 'ensure morulia' first; nothing written"
  exit 0
fi
# An AccountKit older than \$MIN_AK labels the button with a fixed list of
# providers ("Google, Apple, GitHub, X or Facebook") whatever Morulia has on.
# Switching it on there would name providers that lead nowhere, so such an app
# waits; the next run (after its AccountKit bump) switches it on. Every copy of
# the package in the running release counts, so the oldest one decides.
oldest="\$(find "\$OPT/\$APP/app/" -maxdepth 12 -path '*/@bitbaum/accountkit/package.json' 2>/dev/null \\
  | xargs -r -I{} node -e 'process.stdout.write(require(process.argv[1]).version+"\\n")' {} 2>/dev/null \\
  | sort -V | head -n 1 || true)"
if [ -n "\$oldest" ] && [ "\$(printf '%s\\n%s\\n' "\$MIN_AK" "\$oldest" | sort -V | head -n 1)" != "\$MIN_AK" ]; then
  echo "\$APP: runs AccountKit \$oldest, which names providers Morulia may not have on — waits for \$MIN_AK; nothing written"
  exit 0
fi
added=0
for pair in "SIGNIN_ISSUER=\$ISSUER" "SIGNIN_CLIENT_ID=\$CLIENT"; do
  name="\${pair%%=*}"; want="\${pair#*=}"
  if ! has "\$name"; then
    printf '%s=%s\n' "\$name" "\$want" >> "\$ENVF"; added=\$((added+1))
    echo "\$APP: \$name added"
  elif [ "\$(value "\$name")" = "\$want" ]; then
    echo "\$APP: \$name kept"
  else
    echo "\$APP: \$name is set to something else — left alone; fix by hand"
  fi
done
if [ "\$added" -gt 0 ]; then
  chmod 600 "\$ENVF"
  if systemctl is-active --quiet "\$APP-app" 2>/dev/null; then
    sudo systemctl restart "\$APP-app"; sleep 3
    echo "\$APP: restarted \$APP-app: \$(systemctl is-active "\$APP-app" || true)"
  else
    echo "\$APP: \$APP-app is not running — its next start reads the new values"
  fi
fi
REMOTE
  done
  exit "$failed"
fi

# lightning-on: one flag, ACCOUNTKIT_LIGHTNING=1, for apps on AccountKit 0.26.1+.
LIGHTNING_MIN_ACCOUNTKIT="0.26.1"
if [ "$ACTION" = lightning-on ]; then
  ssh -o BatchMode=yes "$BOX_UBUNTU" 'bash -s' <<REMOTE
set -euo pipefail
OPT=$(printf %q "${APP_SECRETS_OPT:-/opt}")
ONE=$(printf %q "$APP")
MIN_AK=$(printf %q "$LIGHTNING_MIN_ACCOUNTKIT")
oldest_ak() {  # the oldest AccountKit copy in an app's running release, or nothing
  # A standalone build traces only the files it runs, so a package.json may be
  # missing from the release; its receipt (stage-release-receipt.sh) names the
  # locked AccountKit, so it is read first.
  receipt="\$OPT/\$1/app/public/.well-known/fleet-release.json"
  if [ -f "\$receipt" ]; then
    node -e 'const a=(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).artifacts||{})["@bitbaum/accountkit"];if(a)process.stdout.write(a+"\\n")' "\$receipt" 2>/dev/null || true
    return 0
  fi
  find "\$OPT/\$1/app/" -maxdepth 12 -path '*/@bitbaum/accountkit/package.json' 2>/dev/null \\
    | xargs -r -I{} node -e 'process.stdout.write(require(process.argv[1]).version+"\\n")' {} 2>/dev/null \\
    | sort -V | head -n 1 || true
}
if [ "\$ONE" = all ]; then
  targets=""
  for dir in "\$OPT"/*/; do
    name="\$(basename "\$dir")"
    [ -n "\$(oldest_ak "\$name")" ] && targets="\$targets \$name"
  done
else
  targets="\$ONE"
fi
for APP in \$targets; do
  ENVF=""
  for cand in "\$OPT/\$APP/shared/.env" "\$OPT/\$APP/app/.env"; do [ -f "\$cand" ] && { ENVF="\$cand"; break; }; done
  [ -n "\$ENVF" ] || { echo "\$APP: no env file on the box — nothing written"; continue; }
  oldest="\$(oldest_ak "\$APP")"
  if [ -z "\$oldest" ]; then
    echo "\$APP: no AccountKit in its release — nothing written"; continue
  fi
  if [ "\$(printf '%s\\n%s\\n' "\$MIN_AK" "\$oldest" | sort -V | head -n 1)" != "\$MIN_AK" ]; then
    echo "\$APP: runs AccountKit \$oldest — waits for \$MIN_AK; nothing written"; continue
  fi
  if grep -qE "^(export[[:space:]]+)?ACCOUNTKIT_LIGHTNING=" "\$ENVF"; then
    echo "\$APP: ACCOUNTKIT_LIGHTNING already set — kept"; continue
  fi
  printf 'ACCOUNTKIT_LIGHTNING=1\\n' >> "\$ENVF"; chmod 600 "\$ENVF"
  echo "\$APP: ACCOUNTKIT_LIGHTNING added"
  if systemctl is-active --quiet "\$APP-app" 2>/dev/null; then
    sudo systemctl restart "\$APP-app"; sleep 3
    echo "\$APP: restarted \$APP-app: \$(systemctl is-active "\$APP-app" || true)"
  else
    echo "\$APP: \$APP-app is not running — its next start reads the flag"
  fi
done
REMOTE
  exit 0
fi

rows() { grep -E "^${APP}\|" <<< "$REGISTRY" || true; }
if [ -z "$(rows)" ]; then
  echo "no generated secrets are registered for $APP (nothing to do)"
  exit 0
fi

# Every value is made HERE and travels to the box on ssh's stdin, inside the
# script below — never in argv, never in a log. The box adds the ones it lacks
# and forgets the rest.
vapid_pair() {  # prints "<public> <private>", web-push's encoding
  node -e '
    const { generateKeyPairSync } = require("crypto");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const j = privateKey.export({ format: "jwk" });
    const b = (s) => Buffer.from(s, "base64url");
    const pub = Buffer.concat([Buffer.from([4]), b(j.x), b(j.y)]).toString("base64url");
    process.stdout.write(pub + " " + j.d + "\n");
  '
}

ASSIGN=""   # shell assignments the remote script evaluates: WANT_<VAR>=<value>
PLAN=""     # var|kind lines the remote script walks
while IFS='|' read -r app var kind; do
  [ -n "$var" ] || continue
  case "$kind" in
    hex32)
      v="$(openssl rand -hex 32)"
      ASSIGN+="WANT_${var}=$(printf %q "$v")"$'\n'
      PLAN+="${var}|hex32"$'\n' ;;
    vapid)
      read -r pub prv < <(vapid_pair)
      ASSIGN+="WANT_${var}_PUBLIC_KEY=$(printf %q "$pub")"$'\n'
      ASSIGN+="WANT_${var}_PRIVATE_KEY=$(printf %q "$prv")"$'\n'
      PLAN+="${var}|vapid"$'\n' ;;
    literal:*)
      ASSIGN+="WANT_${var}=$(printf %q "${kind#literal:}")"$'\n'
      PLAN+="${var}|literal"$'\n' ;;
    pair:*)
      IFS=: read -r _ peer pvar <<< "$kind"
      [[ "$peer" =~ ^[a-z0-9][a-z0-9-]*$ && "$pvar" =~ ^[A-Z][A-Z0-9_]*$ ]] \
        || { echo "bad pair for $var: $kind" >&2; exit 2; }
      v="$(openssl rand -hex 32)"
      ASSIGN+="WANT_${var}=$(printf %q "$v")"$'\n'
      PLAN+="${var}|pair|${peer}|${pvar}"$'\n' ;;
    oc-client:*)
      id="${kind#oc-client:}"
      [[ "$id" =~ ^[a-z0-9][a-z0-9-]*$ && "$var" =~ ^[A-Z][A-Z0-9_]*$ ]] \
        || { echo "bad oc-client for $var: $kind" >&2; exit 2; }
      v="$(openssl rand -hex 32)"
      ASSIGN+="WANT_${var}_SECRET=$(printf %q "$v")"$'\n'
      PLAN+="${var}|oc-client|${id}"$'\n' ;;
    *) echo "unknown kind for $var: $kind" >&2; exit 2 ;;
  esac
done < <(rows)

# APP_SECRETS_OPT moves /opt for test-app-secrets.sh, which runs this remote
# half locally; on the box it is always /opt.
ssh -o BatchMode=yes "$BOX_UBUNTU" 'bash -s' <<REMOTE
set -euo pipefail
OPT=$(printf %q "${APP_SECRETS_OPT:-/opt}")
APP=$(printf %q "$APP")
ACTION=$(printf %q "$ACTION")
OC_DB=$(printf %q "${OC_DB_CONTAINER:-supabase-db}")
$ASSIGN
PLAN=$(printf %q "$PLAN")

# shared/.env is the persistent copy (deploy.sh symlinks each release's .env to
# it); an app not yet migrated to that layout still has only app/.env.
env_of() {
  local cand
  for cand in "\$OPT/\$1/shared/.env" "\$OPT/\$1/app/.env"; do
    [ -f "\$cand" ] && { printf '%s' "\$cand"; return 0; }
  done
  return 1
}
ENVF="\$(env_of "\$APP")" || { echo "no env file for \$APP on the box (looked in shared/ and app/)" >&2; exit 1; }

# has/add/state/value take an optional file; the app's own by default.
has() { grep -qE "^(export[[:space:]]+)?\$1=.+" "\${2:-\$ENVF}"; }
add() { printf '%s=%s\n' "\$1" "\$2" >> "\${3:-\$ENVF}"; }
state() { if has "\$1" "\${2:-\$ENVF}"; then echo "set"; else echo "not set"; fi; }
# The raw right-hand side of the last assignment. Used only to compare and to
# copy between two files on the box; never printed.
value() { grep -E "^(export[[:space:]]+)?\$1=" "\${2:-\$ENVF}" | tail -n 1 | cut -d= -f2-; }

added=0
while IFS='|' read -r var kind peer pvar; do
  [ -n "\$var" ] || continue
  case "\$kind" in
    pair)
      label="\$var = \$peer \$pvar"
      if ! PEERF="\$(env_of "\$peer")"; then
        printf '%-20s %s has no env file on the box — pair skipped, neither side touched\n' "\$var" "\$peer"
        continue
      fi
      if [ "\$ACTION" = show ]; then
        printf '%-20s %s\n' "\$var" "\$(state "\$var")"
        printf '%-20s %s\n' "  \$peer \$pvar" "\$(state "\$pvar" "\$PEERF")"
      elif has "\$var" && has "\$pvar" "\$PEERF"; then
        if [ "\$(value "\$var")" = "\$(value "\$pvar" "\$PEERF")" ]; then
          printf '%s: kept (both set, equal)\n' "\$label"
        else
          printf '%s: MISMATCH — both set, different; left alone; fix by hand\n' "\$label"
        fi
      elif has "\$var"; then
        add "\$pvar" "\$(value "\$var")" "\$PEERF"; chmod 600 "\$PEERF"
        printf '%s: copied to %s (takes effect at its next start)\n' "\$label" "\$peer"
      elif has "\$pvar" "\$PEERF"; then
        add "\$var" "\$(value "\$pvar" "\$PEERF")"
        printf '%s: copied from %s\n' "\$label" "\$peer"; added=\$((added+1))
      else
        w="WANT_\$var"
        add "\$var" "\${!w}"; add "\$pvar" "\${!w}" "\$PEERF"; chmod 600 "\$PEERF"
        printf '%s: added to both (%s takes it at its next start)\n' "\$label" "\$peer"; added=\$((added+1))
      fi ;;
    oc-client)
      id="\$peer"; idv="\${var}_ID"; sv="\${var}_SECRET"; label="\$var (OrangeCat client \$id)"
      # OrangeCat's database, in the supabase-db container (as orangecat's
      # deploy reaches it). Only the sha256 of the secret goes in; the hash is
      # computed here, never printed.
      ocsql() { docker exec -i "\$OC_DB" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1; }
      sha() { printf %s "\$1" | sha256sum | cut -d' ' -f1; }
      if ! row="\$(printf "SELECT coalesce(client_secret_hash, '') || '|' || (disabled_at IS NULL)::text FROM public.oauth_clients WHERE client_id = '%s';\n" "\$id" | ocsql)"; then
        printf '%s: OrangeCat database not reachable — nothing written\n' "\$label"; continue
      fi
      rowhash="\${row%%|*}"
      if [ "\$ACTION" = show ]; then
        printf '%-20s %s\n' "\$idv" "\$(state "\$idv")"
        printf '%-20s %s\n' "\$sv" "\$(state "\$sv")"
        if [ -z "\$row" ]; then rs="no row"; elif [ -z "\$rowhash" ]; then rs="row, no secret (switched off)"; else rs="row with a secret, \$( [ "\${row#*|}" = true ] && echo on || echo off)"; fi
        printf '%-20s %s\n' "  orangecat \$id" "\$rs"
        continue
      fi
      if [ -z "\$row" ]; then
        printf '%s: no such row in OrangeCat yet (orangecat client-specs.ts, created by its deploy) — nothing written\n' "\$label"; continue
      fi
      if ! has "\$sv" && [ -n "\$rowhash" ]; then
        printf '%s: OrangeCat holds a secret this app lacks — left alone; rotate on purpose (register-client.ts --rotate)\n' "\$label"; continue
      fi
      if has "\$sv" && [ -n "\$rowhash" ] && [ "\$(sha "\$(value "\$sv")")" != "\$rowhash" ]; then
        printf '%s: MISMATCH — app and OrangeCat hold different secrets; left alone; fix by hand\n' "\$label"; continue
      fi
      # The app's env first: a failure after it leaves a secret the next run
      # copies into the row, never a row whose secret nobody holds.
      if ! has "\$sv"; then w="WANT_\$sv"; add "\$sv" "\${!w}"; added=\$((added+1)); fresh=1; else fresh=0; fi
      if ! has "\$idv"; then add "\$idv" "\$id"; added=\$((added+1)); fi
      h="\$(sha "\$(value "\$sv")")"
      done_id="\$(printf "UPDATE public.oauth_clients SET client_secret_hash = '%s', disabled_at = NULL WHERE client_id = '%s' AND (client_secret_hash IS NULL OR client_secret_hash = '%s') RETURNING client_id;\n" "\$h" "\$id" "\$h" | ocsql)" || done_id=""
      if [ "\$done_id" = "\$id" ]; then
        if [ "\$fresh" = 1 ]; then printf '%s: added to the app and switched on in OrangeCat\n' "\$label"
        elif [ -z "\$rowhash" ]; then printf '%s: the app'"'"'s secret copied into OrangeCat; switched on\n' "\$label"
        else printf '%s: kept (app and OrangeCat agree; on)\n' "\$label"; fi
      else
        printf '%s: OrangeCat row not updated — the app holds the secret; re-run to finish\n' "\$label"
      fi ;;
    vapid)
      pubv="\${var}_PUBLIC_KEY"; prvv="\${var}_PRIVATE_KEY"
      if [ "\$ACTION" = show ]; then
        printf '%-20s %s\n' "\$pubv" "\$(state "\$pubv")"
        printf '%-20s %s\n' "\$prvv" "\$(state "\$prvv")"
      elif has "\$pubv" && has "\$prvv"; then
        printf '%-20s kept\n' "\$var (pair)"
      elif has "\$pubv" || has "\$prvv"; then
        printf '%-20s HALF A PAIR — left alone; fix by hand\n' "\$var"
      else
        wp="WANT_\$pubv"; wq="WANT_\$prvv"
        add "\$pubv" "\${!wp}"; add "\$prvv" "\${!wq}"
        printf '%-20s added\n' "\$var (pair)"; added=\$((added+2))
      fi ;;
    *)
      if [ "\$ACTION" = show ]; then
        printf '%-20s %s\n' "\$var" "\$(state "\$var")"
      elif has "\$var"; then
        printf '%-20s kept\n' "\$var"
      else
        w="WANT_\$var"; add "\$var" "\${!w}"
        printf '%-20s added\n' "\$var"; added=\$((added+1))
      fi ;;
  esac
done <<< "\$PLAN"

if [ "\$ACTION" = ensure ] && [ "\$added" -gt 0 ]; then
  chmod 600 "\$ENVF"
  if systemctl is-active --quiet "\$APP-app" 2>/dev/null; then
    sudo systemctl restart "\$APP-app"
    sleep 3
    echo "restarted \$APP-app: \$(systemctl is-active "\$APP-app" || true) (\$added values added to \$ENVF)"
  else
    echo "\$added values added to \$ENVF; \$APP-app is not running — its next start reads them"
  fi
elif [ "\$ACTION" = ensure ]; then
  echo "nothing to add for \$APP; not restarted"
fi
REMOTE
