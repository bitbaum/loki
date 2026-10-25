# Sourced by deploy.sh: CI keeps runtime files outside the source checkout.
# Local deployments retain the existing generated-file convention.
readonly SELFHOST_RUNTIME_ENV_PATH="${SELFHOST_ENV_FILE:-$SRC/.env.selfhost.local}"
readonly SELFHOST_SHARED_ENV_PATH="${FLEET_ENV_FILE:-$SRC/.env.fleet}"
if [ ! -f "$SELFHOST_RUNTIME_ENV_PATH" ]; then
  echo "ERROR: runtime environment file missing — run gen-env.sh locally or prepare CI runtime files" >&2
  return 1
fi
if [ -f "$SELFHOST_SHARED_ENV_PATH" ]; then
  set -a
  source "$SELFHOST_SHARED_ENV_PATH"
  set +a
fi
set -a
source "$SELFHOST_RUNTIME_ENV_PATH"
set +a
