#!/usr/bin/env bash
# deploy-local.sh — runs automatically as the npm postbuild hook.
#
# Copies runtime assets into .next/standalone/ (required for the production
# server to serve CSS, JS chunks, public files, and markdown content) then restarts
# the loki-app systemd service if it is installed on this machine.
# Legacy cockpit-app service name is supported as a fallback for transitional installs.
#
# Skips silently in CI or on machines where the service is not installed, so
# running `npm run build` in GitHub Actions stays clean.

set -euo pipefail

# Hosted CI (GitHub Actions, deploy.yml) DOES need the standalone assembly below —
# it ships that assembled tree to the box via `deploy-hetzner.sh --no-build`, which
# hard-fails if `.next/static` isn't inside `.next/standalone`. What CI must NOT run
# is the LOCAL-only tail (schema warning + `systemctl --user restart`): there's no
# local service or local prod to keep consistent there. So we fall through to the
# asset assembly and exit right before that tail (the `${CI:-}` guard below).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STANDALONE="$PROJECT_DIR/.next/standalone"

if [ ! -d "$STANDALONE" ]; then
  # Standalone output not present (e.g. output: "export" override or CI).
  exit 0
fi

# ── Copy runtime assets (atomic swap) ─────────────────────────────────────────
# Next standalone tracing does not include client/static assets or markdown
# loaded from process.cwd() by server-rendered content routes, so we copy them
# in here. The naive `rm -rf <dir>; cp -r <dir>` left a multi-second window where
# the LIVE dir was missing/half-populated — the running server 500'd on
# /whitepaper (reads content/*.md at request time) and served broken CSS/JS until
# the copy finished. swap_dir builds the new tree in a sibling temp dir, then
# renames it into place: the only window where the live dir is absent is between
# two consecutive renames on the same filesystem (microseconds), not seconds.
swap_dir() {
  local src="$1" dest="$2"
  [ -d "$src" ] || return 0
  local tmp="${dest}.new.$$" old="${dest}.old.$$"
  rm -rf "$tmp" "$old"
  mkdir -p "$(dirname "$dest")"
  cp -r "$src" "$tmp"                         # build full tree off to the side
  if [ -e "$dest" ]; then mv "$dest" "$old"; fi  # live aside (instant)
  mv "$tmp" "$dest"                           # new into place (instant)
  rm -rf "$old"                               # drop the old copy after the switch
}

# Clear any swap temporaries left by a previously interrupted deploy.
rm -rf "$STANDALONE/.next/static".new.* "$STANDALONE/.next/static".old.* \
       "$STANDALONE/public".new.*        "$STANDALONE/public".old.* \
       "$STANDALONE/content".new.*       "$STANDALONE/content".old.* 2>/dev/null || true

swap_dir "$PROJECT_DIR/.next/static" "$STANDALONE/.next/static"
swap_dir "$PROJECT_DIR/public"       "$STANDALONE/public"
swap_dir "$PROJECT_DIR/content"      "$STANDALONE/content"
echo "→ deploy: runtime assets swapped into standalone (atomic)"

# ── node-pty native binary ────────────────────────────────────────────────────
# node-pty (the LocalPtyExecutor that backs Loki-owned agent PTYs) loads
# its compiled .node binary dynamically, so Next's file tracer copies the JS
# (lib/, package.json) into standalone but NOT build/Release/pty.node — the
# server then 500s with "Failed to load native module: pty.node". Copy the whole
# build dir alongside it. Same lesson as the assets above. See
# docs/architecture/agent-execution-platform.md.
NODE_PTY_SRC="$PROJECT_DIR/node_modules/node-pty/build"
NODE_PTY_DEST="$STANDALONE/node_modules/node-pty/build"
if [ -d "$NODE_PTY_SRC" ] && [ -d "$STANDALONE/node_modules/node-pty" ]; then
  swap_dir "$NODE_PTY_SRC" "$NODE_PTY_DEST"
  echo "→ deploy: node-pty native binary swapped into standalone (atomic)"
fi

# (The former shiki top-level link is gone: bip-kit 0.2.1's setHighlighterLoader
# seam makes shiki a normal bundled dependency — nothing for the tracer to miss.)

# Hosted CI stops here: the standalone is fully assembled (all deploy-hetzner.sh
# --no-build needs), and everything below is local-machine-only (a schema warning
# against the local DB, and restarting the local systemd service — neither of
# which exists on a GitHub runner shipping to a remote box).
if [ -n "${CI:-}" ]; then
  echo "→ deploy: CI — standalone assembled; skipping local schema-warning + systemd restart"
  exit 0
fi

# ── Schema-drift warning (non-fatal, read-only) ───────────────────────────────
# A table added in src/db/schema but never pushed to this box's database silently
# 500s the first feature that queries it (how /prompts, /loki and System cron
# went dark). Surface drift on every local build so it's caught here, not by a
# user hitting a blank page. Never blocks the deploy — a stale build still beats
# no restart — so the check is fully isolated behind `|| true`.
DRIFT_OUT="$(pnpm run --silent check:schema 2>&1 || true)"
if grep -q "MISSING" <<<"$DRIFT_OUT"; then
  echo "→ deploy: ⚠ SCHEMA DRIFT DETECTED — on a local/scratch DB run \`npm run db:push\` (drizzle-kit push):"
  printf '%s\n' "$DRIFT_OUT" | sed 's/^/    /'
fi

# ── Pinned-deploy guard ───────────────────────────────────────────────────────
# When deploy-hetzner.sh runs a pinned (--ref) build it exports LOKI_DEPLOY_REF.
# If HEAD drifted during the build (a branch switch landed mid-compile), the
# standalone we just assembled may be torn — so don't restart the LOCAL service
# into it. deploy-hetzner.sh's own AFTER==REF check already aborts the box rsync;
# this keeps local consistent, so one mid-build `git checkout` ships nothing,
# anywhere, instead of silently leaving local prod on a torn build.
if [ -n "${LOKI_DEPLOY_REF:-}" ]; then
  HEAD_NOW="$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  if [ "$HEAD_NOW" != "$LOKI_DEPLOY_REF" ]; then
    echo "→ deploy: ⚠ HEAD drifted to ${HEAD_NOW:0:12} (pinned ${LOKI_DEPLOY_REF:0:12}) — skipping local restart; build may be torn"
    exit 0
  fi
fi

# ── Restart systemd service (local machine only) ──────────────────────────────
# Prefer the canonical loki-app service; fall back to legacy cockpit-app
# for machines still running the pre-rename install.
for SERVICE in loki-app cockpit-app; do
  SERVICE_FILE="$HOME/.config/systemd/user/${SERVICE}.service"
  if [ -f "$SERVICE_FILE" ] && systemctl --user is-enabled --quiet "$SERVICE" 2>/dev/null; then
    systemctl --user restart "$SERVICE"
    echo "→ deploy: ${SERVICE} service restarted"
    break
  fi
done
