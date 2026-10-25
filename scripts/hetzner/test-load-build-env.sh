#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/source checkout" "$fixture/runtime files"
printf 'FLEET_TEST_PRIORITY=shared\nFLEET_TEST_SHARED=available\n' > "$fixture/runtime files/shared.env"
printf 'FLEET_TEST_PRIORITY=app\nFLEET_TEST_APP=available\n' > "$fixture/runtime files/app.env"
SRC="$fixture/source checkout" SELFHOST_ENV_FILE="$fixture/runtime files/app.env" FLEET_ENV_FILE="$fixture/runtime files/shared.env" \
  bash -euo pipefail -c '
    source "$1/load-build-env.sh"
    test "$FLEET_TEST_PRIORITY" = app
    test "$FLEET_TEST_SHARED" = available
    test "$FLEET_TEST_APP" = available
    test "$SELFHOST_RUNTIME_ENV_PATH" = "$SELFHOST_ENV_FILE"
    test -z "$(find "$SRC" -type f -print -quit)"
    bash -c '\''test "$FLEET_TEST_PRIORITY" = app'\''
  ' -- "$here"
cp "$fixture/runtime files/app.env" "$fixture/source checkout/.env.selfhost.local"
SRC="$fixture/source checkout" bash -euo pipefail -c '
  unset SELFHOST_ENV_FILE FLEET_ENV_FILE
  source "$1/load-build-env.sh"
  test "$FLEET_TEST_PRIORITY" = app
  test "$SELFHOST_RUNTIME_ENV_PATH" = "$SRC/.env.selfhost.local"
' -- "$here"
if SRC="$fixture/source checkout" SELFHOST_ENV_FILE="$fixture/missing" bash -euo pipefail -c 'source "$1/load-build-env.sh"' -- "$here" 2>/dev/null; then
  echo 'missing runtime file was accepted' >&2
  exit 1
fi
echo 'load-build-env: external quoted paths, export, app precedence, clean source, local fallback and missing file passed'
