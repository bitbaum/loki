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
# - Restarts <app>-app only when something was added (launch.sh sources .env
#   at start; nothing is baked into the build).
#
# REGISTRY: app|VAR|kind — mirror of what each app reads from process.env.
#   hex32            64 hex characters (openssl rand)
#   vapid            VAR is the prefix: VAR_PUBLIC_KEY + VAR_PRIVATE_KEY, P-256
#   literal:<value>  a constant (a mailto: subject, say)
#
# Usage (from a laptop or the workflow; needs ssh to the box as ubuntu):
#   bash scripts/hetzner/app-secrets.sh show   heidi
#   bash scripts/hetzner/app-secrets.sh ensure heidi
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_UBUNTU

ACTION="${1:?usage: app-secrets.sh show|ensure <app>}"
APP="${2:?usage: app-secrets.sh show|ensure <app>}"
case "$ACTION" in show|ensure) ;; *) echo "unknown action: $ACTION (show|ensure)" >&2; exit 2 ;; esac
case "$APP" in *[!a-z0-9-]*|"") echo "app name must be [a-z0-9-]: $APP" >&2; exit 2 ;; esac

REGISTRY="$(cat <<'REG'
# heidi: the hourly channel sweep (install-app-crons.sh row) presents
# CRON_SECRET; VAPID_* turns Web Push on (heidi lib/push/send.ts). The subject
# is the site's contact address (heidi lib/config/site.ts CONTACT_EMAIL).
heidi|CRON_SECRET|hex32
heidi|VAPID|vapid
heidi|VAPID_SUBJECT|literal:mailto:cato@orangecat.ch
REG
)"

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
    *) echo "unknown kind for $var: $kind" >&2; exit 2 ;;
  esac
done < <(rows)

ssh -o BatchMode=yes "$BOX_UBUNTU" 'bash -s' <<REMOTE
set -euo pipefail
APP=$(printf %q "$APP")
ACTION=$(printf %q "$ACTION")
$ASSIGN
PLAN=$(printf %q "$PLAN")

# shared/.env is the persistent copy (deploy.sh symlinks each release's .env to
# it); an app not yet migrated to that layout still has only app/.env.
ENVF=""
for cand in "/opt/\$APP/shared/.env" "/opt/\$APP/app/.env"; do
  [ -f "\$cand" ] && { ENVF="\$cand"; break; }
done
[ -n "\$ENVF" ] || { echo "no env file for \$APP on the box (looked in shared/ and app/)" >&2; exit 1; }

has() { grep -qE "^(export[[:space:]]+)?\$1=.+" "\$ENVF"; }
add() { printf '%s=%s\n' "\$1" "\$2" >> "\$ENVF"; }
state() { if has "\$1"; then echo "set"; else echo "not set"; fi; }

added=0
while IFS='|' read -r var kind; do
  [ -n "\$var" ] || continue
  case "\$kind" in
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
  sudo systemctl restart "\$APP-app"
  sleep 3
  echo "restarted \$APP-app: \$(systemctl is-active "\$APP-app" || true) (\$added values added to \$ENVF)"
elif [ "\$ACTION" = ensure ]; then
  echo "nothing to add for \$APP; not restarted"
fi
REMOTE
