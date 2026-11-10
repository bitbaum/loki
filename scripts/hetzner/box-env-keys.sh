#!/usr/bin/env bash
# box-env-keys.sh — vendor keys a person pasted into GitHub Actions secrets,
# written into one app's env ON THE BOX (.github/workflows/box-env-keys.yml).
#
# WHY
# ---
# The box's .env is the runtime SSOT; selfhost-deploy.yml pulls it from there.
# A key from a vendor (an OAuth client id and secret from Google, GitHub, …)
# has to get there somehow, and "ssh to the box and edit a file" is not a step
# the owner should ever be given. So the owner pastes the key ONCE, as a
# secret of the app's repository, and the app's own workflow calls
# box-env-keys.yml, which runs this. First user: Morulia's sign-in providers
# (bitbaum/morulia .github/workflows/provider-keys.yml).
#
# RULES
# - Only the NAMES the caller lists are written; every other secret the
#   repository holds is ignored. Names must be [A-Z][A-Z0-9_]* and must not
#   start with GITHUB_ (GitHub Actions reserves that prefix and refuses the secret).
# - A secret that is set in GitHub wins: missing on the box → added; different
#   → replaced (pasting a new key in GitHub IS the rotation). A secret that is
#   NOT set in GitHub leaves the box's line alone — absence is not a deletion.
# - Prints names and added/replaced/kept, never a value. This repo is public,
#   so the workflow's log is too.
# - Restarts <app>-app only when something changed and the unit is running.
# - Values are written so bash `source` (launch.sh) and dotenv both read them
#   back exactly: a plain token as is, anything else single-quoted. A value
#   with newlines (a PEM key) is stored with literal \n, which Morulia accepts.
#
# Values come from this process's environment, under the same names; the
# workflow sets them from the caller's secrets and nothing else.
#
# Usage: box-env-keys.sh <app> <NAME> [<NAME> ...]
# Prints `changed=<n>` last, for the workflow's next step.
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_UBUNTU

APP="${1:?usage: box-env-keys.sh <app> <NAME>...}"
shift
case "$APP" in *[!a-z0-9-]*|"") echo "app name must be [a-z0-9-]: $APP" >&2; exit 2 ;; esac
[ "$#" -gt 0 ] || { echo "name at least one variable" >&2; exit 2; }

# The right-hand side as it goes in the file.
render() {
  local v="${1//$'\r'/}"
  v="${v//$'\n'/\\n}"
  if [[ "$v" =~ ^[A-Za-z0-9._~+/=:@-]+$ ]]; then
    printf '%s' "$v"
  else
    printf "'%s'" "${v//\'/\'\\\'\'}"
  fi
}

ASSIGN=""   # WANT_<NAME>=<rendered>, evaluated on the box
PLAN=""     # NAME per line
absent=()
for name in "$@"; do
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "bad variable name: $name" >&2; exit 2; }
  [[ "$name" =~ ^GITHUB_ ]] && { echo "GitHub Actions refuses secret names starting with GITHUB_ (they are reserved): $name. Use a name that does not start with GITHUB_, for example GH_CLIENT_ID instead of GITHUB_CLIENT_ID." >&2; exit 2; }
  value="${!name-}"
  if [ -z "${value//[[:space:]]/}" ]; then absent+=("$name"); continue; fi
  ASSIGN+="WANT_${name}=$(printf %q "$(render "$value")")"$'\n'
  PLAN+="$name"$'\n'
done
for name in "${absent[@]}"; do printf '%-28s not in GitHub — box left as it is\n' "$name"; done
if [ -z "$PLAN" ]; then
  echo "changed=0"
  exit 0
fi

# BOX_ENV_KEYS_OPT moves /opt for test-box-env-keys.sh, which runs the remote
# half locally; on the box it is always /opt.
ssh -o BatchMode=yes "$BOX_UBUNTU" 'bash -s' <<REMOTE
set -euo pipefail
OPT=$(printf %q "${BOX_ENV_KEYS_OPT:-/opt}")
APP=$(printf %q "$APP")
$ASSIGN
PLAN=$(printf %q "$PLAN")
ENVF=""
for cand in "\$OPT/\$APP/shared/.env" "\$OPT/\$APP/app/.env"; do
  [ -f "\$cand" ] && { ENVF="\$cand"; break; }
done
[ -n "\$ENVF" ] || { echo "no env file for \$APP on the box (looked in shared/ and app/)" >&2; exit 1; }
current() { grep -E "^(export[[:space:]]+)?\$1=" "\$ENVF" | tail -n 1 | cut -d= -f2-; }
changed=0
while IFS= read -r name; do
  [ -n "\$name" ] || continue
  w="WANT_\$name"; want="\${!w}"
  if ! grep -qE "^(export[[:space:]]+)?\$name=" "\$ENVF"; then
    printf '%s=%s\n' "\$name" "\$want" >> "\$ENVF"
    printf '%-28s added\n' "\$name"; changed=\$((changed+1))
  elif [ "\$(current "\$name")" = "\$want" ]; then
    printf '%-28s kept\n' "\$name"
  else
    tmp="\$(mktemp "\$ENVF.XXXXXX")"
    grep -vE "^(export[[:space:]]+)?\$name=" "\$ENVF" > "\$tmp" || true
    printf '%s=%s\n' "\$name" "\$want" >> "\$tmp"
    chmod 600 "\$tmp"; mv "\$tmp" "\$ENVF"
    printf '%-28s replaced (GitHub holds a different value)\n' "\$name"; changed=\$((changed+1))
  fi
done <<< "\$PLAN"
chmod 600 "\$ENVF"
if [ "\$changed" -gt 0 ]; then
  if systemctl is-active --quiet "\$APP-app" 2>/dev/null; then
    sudo systemctl restart "\$APP-app"; sleep 3
    echo "restarted \$APP-app: \$(systemctl is-active "\$APP-app" || true)"
  else
    echo "\$APP-app is not running — its next start reads the new values"
  fi
fi
echo "changed=\$changed"
REMOTE
