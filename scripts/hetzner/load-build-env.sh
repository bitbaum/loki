# Sourced by deploy.sh: CI keeps runtime files outside the source checkout.
# Local deployments retain the existing generated-file convention.
readonly SELFHOST_RUNTIME_ENV_PATH="${SELFHOST_ENV_FILE:-$SRC/.env.selfhost.local}"
readonly SELFHOST_SHARED_ENV_PATH="${FLEET_ENV_FILE:-$SRC/.env.fleet}"
if [ ! -f "$SELFHOST_RUNTIME_ENV_PATH" ]; then
  echo "ERROR: runtime environment file missing — run gen-env.sh locally or prepare CI runtime files" >&2
  return 1
fi
# Shared keys first, then the app's; an EMPTY app line keeps the fleet value
# and FLEET_KEYS_OFF names the keys an app switches off — the rule
# launch.sh.tmpl applies at runtime, so the build sees what the server will.
__fleet_keys=""
if [ -f "$SELFHOST_SHARED_ENV_PATH" ]; then
  set -a
  source "$SELFHOST_SHARED_ENV_PATH"
  set +a
  for __fk in $(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' "$SELFHOST_SHARED_ENV_PATH"); do
    printf -v "__fleet_$__fk" '%s' "${!__fk-}"; __fleet_keys="$__fleet_keys $__fk"
  done
fi
set -a
source "$SELFHOST_RUNTIME_ENV_PATH"
set +a
for __fk in $__fleet_keys; do
  __fv="__fleet_$__fk"; [ -n "${!__fk-}" ] || export "$__fk=${!__fv}"; unset "$__fv"
done
for __fk in ${FLEET_KEYS_OFF-}; do unset "$__fk"; done
unset __fleet_keys __fk __fv
