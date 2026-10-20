#!/usr/bin/env bash
# new-tenant.sh — give ONE account its own private builder on this box.
#
# Runs ON the box as root (reconcile-tenants.sh calls it for every account
# whose users.private_builder is on; it can also be run by hand). Idempotent:
# a tenant that exists is brought up to date, never recreated.
#
#   new-tenant.sh <userId>            create or refresh the tenant's builder
#   new-tenant.sh <userId> --retire   stop its unit; the home is kept
#
# What a tenant is (docs/architecture/private-builders.md): a system user
# lk-<short> (short = first 8 characters of the user id, the same derivation
# as src/lib/agent-execution/box-workspace-path.ts tenantDevRoot), its home
# with a clean shell, its dev root, a runner token minted for THAT user, the
# agent operating contract in its ~/.claude/CLAUDE.md, an env file that holds
# only its engine keys, and an instance of the loki-box-runner@.service
# template. The tenant then signs in to Claude Code from their own Sessions
# page (`claude` → `/login`), in their own home.
set -euo pipefail

USER_ID="${1:-}"
MODE="${2:-}"
[[ "$USER_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
  || { echo "usage: new-tenant.sh <userId uuid> [--retire]" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "new-tenant.sh must run as root" >&2; exit 2; }

SHORT="${USER_ID:0:8}"
TENANT="lk-${SHORT}"
HOME_DIR="/home/${TENANT}"
UNIT="loki-box-runner@${SHORT}.service"
RUNNER_DIR="/opt/loki/runner"
RUNNERS_ENV_DIR="/etc/loki/runners"
TEMPLATE_SRC="${RUNNER_DIR}/scripts/loki-box-runner@.service"
TEMPLATE_DST="/etc/systemd/system/loki-box-runner@.service"
CONTRACT="${RUNNER_DIR}/scripts/box-agent-claude.md"

log() { echo "[new-tenant ${SHORT}] $*"; }

if [ "$MODE" = "--retire" ]; then
  if systemctl list-unit-files "$UNIT" --no-legend 2>/dev/null | grep -q .; then
    systemctl disable --now "$UNIT" 2>/dev/null || true
    log "unit stopped and disabled; ${HOME_DIR} kept"
  else
    log "no unit to retire"
  fi
  exit 0
fi

# 1. The system user: no password, its own group, a home nobody else reads.
if ! id "$TENANT" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --user-group "$TENANT"
  log "user ${TENANT} created"
fi
chmod 0750 "$HOME_DIR"
mkdir -p "$HOME_DIR/dev" "$HOME_DIR/.config/loki" "$HOME_DIR/.claude" "$HOME_DIR/.local/bin" "$HOME_DIR/.npm-global"

# 2. A clean shell. `bash -lic` (launch.ts) sources these before every agent,
#    so they must export nothing but PATH — the owner's ~/.bashrc once
#    exported a retired token to every agent (builder-auth-check.sh).
cat > "$HOME_DIR/.bashrc" <<'RC'
# Loki private builder — written by new-tenant.sh. PATH only; no secrets here.
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin"
export npm_config_prefix="$HOME/.npm-global"
RC
cat > "$HOME_DIR/.profile" <<'RC'
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
RC

# 3. The runner token, minted for THIS user. Minting needs the database, so it
#    runs here as root with the runner's env — the tenant's own unit never has
#    it. The file is the tenant's, mode 0600 (desktop/src/main/token-store.ts).
TOKEN_FILE="$HOME_DIR/.config/loki/fleet-runner-token"
if [ ! -s "$TOKEN_FILE" ]; then
  ( cd "$RUNNER_DIR" && set -a && . ./.env && set +a \
    && node_modules/.bin/tsx scripts/mint-box-runner-token.ts "$TOKEN_FILE" --user "$USER_ID" )
  log "runner token minted"
fi

# 4. The agent operating contract (box-agent-claude.md) in the tenant's own
#    ~/.claude/CLAUDE.md — the same managed block apply-box-agent-contract.sh
#    writes for the owner. Merge-only: anything outside the markers survives.
BEGIN="<!-- BEGIN loki-managed: box agent contract -->"
END="<!-- END loki-managed: box agent contract -->"
TARGET="$HOME_DIR/.claude/CLAUDE.md"
touch "$TARGET"
outside=$(awk -v b="$BEGIN" -v e="$END" '
  index($0, b) { skip = 1; next }
  index($0, e) { skip = 0; next }
  !skip        { print }
' "$TARGET")
{
  printf '%s\n' "$BEGIN"
  printf '%s\n' "<!-- Generated from scripts/hetzner/box-agent-claude.md — edit there, not here. -->"
  cat "$CONTRACT"
  printf '%s\n' "$END"
  if grep -q '[^[:space:]]' <<<"$outside"; then
    printf '\n%s\n' "$(printf '%s' "$outside" | sed -e 's/[[:space:]]*$//')"
  fi
} > "$TARGET.tmp"
mv "$TARGET.tmp" "$TARGET"

# 5. Claude Code in the tenant's own home, so `claude` is on their PATH and
#    `/login` signs in THEIR account. Best effort: a tenant without it is told
#    so on their Sessions page, and the runner's install_cli can add it later.
if [ ! -x "$HOME_DIR/.npm-global/bin/claude" ]; then
  if sudo -u "$TENANT" -H bash -lc 'npm install -g @anthropic-ai/claude-code' >/dev/null 2>&1; then
    log "claude installed in ${HOME_DIR}/.npm-global"
  else
    log "⚠ could not install claude for ${TENANT} (npm or network); the runner will try again"
  fi
fi

chown -R "$TENANT:$TENANT" "$HOME_DIR"
chmod 0600 "$TOKEN_FILE"

# 6. The env file: only this tenant's engine keys (Settings → Your engine
#    writes them). Root-owned; systemd reads it, the tenant's unit does not.
mkdir -p "$RUNNERS_ENV_DIR"
chmod 0700 "$RUNNERS_ENV_DIR"
ENV_FILE="$RUNNERS_ENV_DIR/${SHORT}.env"
[ -f "$ENV_FILE" ] || { : > "$ENV_FILE"; chmod 0600 "$ENV_FILE"; }

# 7. The unit, from the versioned template.
[ -f "$TEMPLATE_SRC" ] || { echo "✗ missing ${TEMPLATE_SRC} (deploy syncs it)" >&2; exit 1; }
if ! cmp -s "$TEMPLATE_SRC" "$TEMPLATE_DST"; then
  install -m 0644 "$TEMPLATE_SRC" "$TEMPLATE_DST"
  systemctl daemon-reload
  log "unit template installed"
fi
systemctl enable --now "$UNIT" >/dev/null 2>&1 || systemctl restart "$UNIT"
sleep 3
if systemctl is-active "$UNIT" >/dev/null 2>&1; then
  log "✓ ${UNIT} active — the tenant signs in from their Sessions page: start claude, type /login"
else
  log "✗ ${UNIT} is not active: journalctl -u ${UNIT} -n 30"
  exit 1
fi
