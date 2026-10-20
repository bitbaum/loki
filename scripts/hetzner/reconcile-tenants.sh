#!/usr/bin/env bash
# reconcile-tenants.sh — make the box's private builders match users.private_builder.
#
# Runs ON the box as root every minute (loki-tenants.timer, installed by
# install-tenant-reconcile.sh from the deploy). The flag is the one switch:
# the operator turns it on in System → Plans, and within a minute the
# account has its own builder (new-tenant.sh); turned off, the unit stops and
# the home is kept. Nobody opens a shell for either. Idempotent and quiet:
# a run that changes nothing prints nothing.
set -euo pipefail

RUNNER_DIR="/opt/loki/runner"
NEW_TENANT="${RUNNER_DIR}/scripts/new-tenant.sh"
[ -f "$NEW_TENANT" ] || { echo "✗ missing ${NEW_TENANT}" >&2; exit 1; }

# The database password lives in the runner's env for the owner's legacy
# unit and for root-side jobs like this one; no tenant unit ever sees it.
set -a; . "${RUNNER_DIR}/.env"; set +a
: "${DATABASE_URL:?DATABASE_URL missing in ${RUNNER_DIR}/.env}"

wanted="$(psql "$DATABASE_URL" -At -c "select id from users where private_builder = true and is_default = false order by created_at" 2>/dev/null || true)"

# Bring up every wanted tenant that has no active unit (or refresh one whose
# template changed: new-tenant.sh is idempotent and cheap when nothing moved).
while IFS= read -r uid; do
  [ -n "$uid" ] || continue
  short="${uid:0:8}"
  if ! systemctl is-active "loki-box-runner@${short}.service" >/dev/null 2>&1; then
    bash "$NEW_TENANT" "$uid" || echo "⚠ new-tenant failed for ${short}" >&2
  fi
done <<<"$wanted"

# Each tenant's engine keys — the ones they marked "also for building" —
# into its unit env (scripts/write-tenant-engines.ts needs the database and
# the app's BYOK_SEAL_SECRET, which only root-side jobs hold). A unit whose
# file changed is drain-restarted so the key reaches its next agent without
# ending a session mid-task.
changed="$( cd "$RUNNER_DIR" && set -a && . /opt/loki/app/.env 2>/dev/null; set +a; \
  node_modules/.bin/tsx scripts/write-tenant-engines.ts 2>/dev/null || true )"
while IFS= read -r short; do
  [ -n "$short" ] || continue
  r="loki-runner-restart-loki-box-runner-${short}"
  systemctl is-active "$r.service" >/dev/null 2>&1 && continue
  systemctl reset-failed "$r.service" 2>/dev/null || true
  systemd-run --unit="$r" --collect --quiet \
    --description="Loki: restart loki-box-runner@${short} once its agents drain (engine keys changed)" \
    /bin/bash "${RUNNER_DIR}/scripts/drain-and-restart-runner.sh" "loki-box-runner@${short}" 2>/dev/null || true
done <<<"$changed"

# Retire every running instance whose account no longer wants one.
for unit in $(systemctl list-units 'loki-box-runner@*' --no-legend --plain 2>/dev/null | awk '{print $1}'); do
  short="${unit#loki-box-runner@}"; short="${short%.service}"
  if ! grep -q "^${short}" <<<"$wanted"; then
    uid="$(psql "$DATABASE_URL" -At -c "select id from users where id::text like '${short}%' limit 1" 2>/dev/null || true)"
    [ -n "$uid" ] && bash "$NEW_TENANT" "$uid" --retire || systemctl disable --now "$unit" 2>/dev/null || true
  fi
done
