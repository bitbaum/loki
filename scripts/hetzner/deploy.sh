#!/usr/bin/env bash
# Build a Next.js app (standalone) and deploy it to /opt/<name>/app on the box.
# Generalizes the orangecat/revampit cutover flow from the runbook:
#   build → stage standalone + static + public → rsync → restart → health check.
# Runtime env: <repo>/<app_dir>/.env.selfhost.local is uploaded as /opt/<name>/app/.env
# ONLY if missing on the box (box env is never overwritten — fix it there or pass --env).
# Usage: deploy.sh <app> [--env]   (--env force-uploads .env.selfhost.local)
# Absolute script dir, resolved BEFORE the cd into the app repo below — a
# relative invocation (`bash deploy.sh app` from this dir) otherwise resolves
# sibling scripts as ./apply-schema.sh inside the APP repo and aborts the
# deploy. The push-deploy hook always passed absolute paths, which is why this
# never fired until a manual relative run (2026-07-17).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

app_lookup "${1:?usage: deploy.sh <app> [--env]}"
FORCE_ENV="${2:-}"
# Receipt scope comes from the deployment caller, before app runtime env is read.
readonly receipt_public_scope="${FLEET_RECEIPT_PUBLIC:-}"
readonly receipt_producer_root="${FLEET_RECEIPT_ROOT:-}"
readonly receipt_repository="${FLEET_RECEIPT_REPO:-}"
readonly receipt_projects="${FLEET_RECEIPT_PROJECTS:-}"
# apps.conf records the LAPTOP checkout path. A CI runner has the same repo at a
# different path, so REPO_OVERRIDE re-points just that field — name/port/domains/
# app_dir/db still come from the manifest, which stays the single source of truth.
REPO="${REPO_OVERRIDE:-$REPO}"
SRC="$REPO/$APP_DIR"

[ -d "$SRC" ] || { echo "ERROR: $SRC missing"; exit 1; }
cd "$SRC"

# Build with the runtime env: NEXT_PUBLIC_* is baked at build time, and SSG
# pages may query the DB — tunnel build-time DB access to the box's Postgres.
# CI supplies external runtime paths; local deployments keep generated files.
source "$HERE/load-build-env.sh" || exit 1
STAGE=""
TUNNEL_SOCK=$(mktemp -u /tmp/deploy-tunnel.XXXXXX)
ssh -o BatchMode=yes -f -N -M -S "$TUNNEL_SOCK" -L 15432:localhost:5432 "$BOX"
# `ssh -f` returns as soon as it backgrounds itself, which is BEFORE the
# forwarded port is necessarily accepting connections. prisma then connects to
# nothing and the deploy aborts at the schema step with a bare P1001 that reads
# like "the box's Postgres is down" — it is not, the tunnel just was not up yet.
# Intermittent by nature: it depends on how fast the box answers, so it passes
# on a quiet box and fails on a loaded one. Wait for the port to actually accept.
tunnel_up=false
for _ in $(seq 1 40); do
  if (exec 3<>/dev/tcp/127.0.0.1/15432) 2>/dev/null; then
    exec 3<&- 3>&-; tunnel_up=true; break
  fi
  sleep 0.25
done
if ! $tunnel_up; then
  echo "ERROR: DB tunnel to $BOX never started listening on 127.0.0.1:15432 (waited 10s)."
  echo "       Check SSH access to $BOX; the box's Postgres itself may be fine."
  ssh -S "$TUNNEL_SOCK" -O exit "$BOX" 2>/dev/null || true
  exit 1
fi
trap 'ssh -S "$TUNNEL_SOCK" -O exit "$BOX" 2>/dev/null; [ -n "$STAGE" ] && rm -rf "$STAGE"' EXIT
[ -n "${DATABASE_URL:-}" ] && export DATABASE_URL="${DATABASE_URL/@localhost:5432/@127.0.0.1:15432}"
[ -n "${DIRECT_URL:-}" ] && export DIRECT_URL="${DIRECT_URL/@localhost:5432/@127.0.0.1:15432}"

# Reconcile DB schema BEFORE building — SSG may query columns/tables that the new
# code introduces. Guarded: applies only pending, additive migrations and refuses
# any destructive diff (aborts without shipping). See apply-schema.sh.
if [ "$DB" != "-" ]; then
  "$HERE/apply-schema.sh" "$NAME" "$REPO" "$DB" "$APP_DIR" \
    || { echo "ERROR: schema step failed — deploy aborted (no code shipped)"; exit 1; }
fi

echo "=== build $NAME ($SRC) ==="
# Use the same manager as dependency installation. New sites use npm; invoking
# pnpm here used to fail with exit 127 after a successful npm ci in Actions.
BUILD_PACKAGE_MANAGER="${BUILD_PACKAGE_MANAGER:-}"
if [ -z "$BUILD_PACKAGE_MANAGER" ]; then
  if [ -f "$SRC/pnpm-lock.yaml" ] || [ -f "$REPO/pnpm-lock.yaml" ]; then BUILD_PACKAGE_MANAGER=pnpm
  elif [ -f "$SRC/yarn.lock" ] || [ -f "$REPO/yarn.lock" ]; then BUILD_PACKAGE_MANAGER=yarn
  else BUILD_PACKAGE_MANAGER=npm; fi
fi
case "$BUILD_PACKAGE_MANAGER" in npm|pnpm|yarn) ;; *) echo "ERROR: unsupported package manager"; exit 1 ;; esac
SELF_HOST=1 "$BUILD_PACKAGE_MANAGER" run build

ST="$SRC/.next/standalone"
[ -d "$ST" ] || { echo "ERROR: no standalone output — set output:'standalone' in next.config"; exit 1; }

STAGE=$(mktemp -d)
cp -r "$ST"/. "$STAGE/"
# static + public live next to the (possibly monorepo-nested) server.js
NEST=$(cd "$STAGE" && find . -maxdepth 4 -name server.js -not -path '*node_modules*' | head -1 | xargs dirname)
# Copy CONTENTS into the target, never the directory itself: `cp -r public
# dest/public` nests (dest/public/public) when the target already exists, and
# it does whenever the app imports a file from public/ — Next's output tracing
# then puts that file in the standalone bundle first. Substrata imports
# public/geo/*.json, so every other public file (its install icons) shipped one
# level down and answered 404 in production while geo kept working.
mkdir -p "$STAGE/$NEST/.next/static"
cp -r "$SRC/.next/static/." "$STAGE/$NEST/.next/static/"
if [ -d "$SRC/public" ]; then
  mkdir -p "$STAGE/$NEST/public"
  cp -r "$SRC/public/." "$STAGE/$NEST/public/"
fi

# Fleet owns artifact parsing. Stamp the exact staged output, including nested
# standalone servers, before rsync and the atomic release swap.
FLEET_RECEIPT_PUBLIC="$receipt_public_scope" FLEET_RECEIPT_ROOT="$receipt_producer_root" \
  FLEET_RECEIPT_REPO="$receipt_repository" \
  FLEET_RECEIPT_PROJECTS="$receipt_projects" \
  bash "$HERE/stage-release-receipt.sh" "$REPO" "$SRC" "$STAGE/$NEST"

# ── Releases layout (rollback-able deploys) ─────────────────────────────────
# /opt/<name>/shared/{.env,launch.sh}        persistent box-side files
# /opt/<name>/releases/<ts>-<sha>/           one dir per deploy
# /opt/<name>/app -> releases/<ts>-<sha>     ATOMIC symlink; systemd units keep
#                                            pointing at /opt/<name>/app unchanged.
# A failed health check flips the symlink back to the previous release
# (auto-rollback); rollback.sh <app> does the same on demand. Legacy layout
# (app as a real dir) is migrated in place on the first release-deploy.
REL="$(date +%Y%m%d-%H%M%S)-$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo nosha)"
RELDIR="/opt/$NAME/releases/$REL"

# One-time shared/ bootstrap: COPY (not move — the running service still uses
# them) .env + launch.sh out of a legacy app dir. Idempotent.
#
# launch.sh is NOT patched here. It is generated from
# scripts/hetzner/launch.sh.tmpl by sync-infra.sh, which is the single writer.
# This used to sed `pwd` → `pwd -P` into the generated file after the fact,
# which repaired the output while leaving the generator emitting the broken
# version — so the bug came back the moment sync-infra ran without a deploy
# behind it (sbb-fundbuero, 2026-09-08). A legacy copy above may still be
# stale; `sync-infra.sh <app>` rewrites it from the template.
box "set -e
  mkdir -p /opt/$NAME/releases /opt/$NAME/shared
  if [ -d /opt/$NAME/app ] && [ ! -L /opt/$NAME/app ]; then
    [ -f /opt/$NAME/shared/.env ]      || cp -p /opt/$NAME/app/.env /opt/$NAME/shared/.env 2>/dev/null || true
    [ -f /opt/$NAME/shared/launch.sh ] || cp -p /opt/$NAME/app/launch.sh /opt/$NAME/shared/launch.sh 2>/dev/null || true
  fi"

if [ "$FORCE_ENV" = "--env" ] || ! box "test -f /opt/$NAME/shared/.env"; then
  [ -f "$SELFHOST_RUNTIME_ENV_PATH" ] || { echo "ERROR: runtime environment file missing"; exit 1; }
  scp -o BatchMode=yes "$SELFHOST_RUNTIME_ENV_PATH" "$BOX:/opt/$NAME/shared/.env"
  # Ownership, not just mode. The app sources this file as its unit's User=;
  # a .env it cannot read is a total outage (twice on 2026-08-28), and the
  # correct owner is never in doubt. Assert it here as well as in
  # host-check's repair loop, so the invariant is stated where the file is
  # written and not only where it is later found broken.
  box "sudo chown ubuntu:ubuntu /opt/$NAME/shared/.env && chmod 600 /opt/$NAME/shared/.env"
  echo "uploaded .env → shared/"
fi

echo "=== rsync → $RELDIR ==="
for attempt in 1 2 3; do
  rsync -az --partial \
    -e "ssh -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4" \
    --exclude '.env' --exclude 'launch.sh' \
    "$STAGE"/ "$BOX:$RELDIR/" && break
  echo "rsync attempt $attempt failed, retrying in 5s..."; sleep 5
  [ "$attempt" = 3 ] && { echo "ERROR: rsync failed after 3 attempts"; exit 1; }
done

# Wire shared files into the release, remember the current target for
# rollback, then swap ATOMICALLY (ln to temp name + rename over) and restart.
PREV=$(box "readlink /opt/$NAME/app 2>/dev/null || true")
box "set -e
  ln -sfn /opt/$NAME/shared/.env      '$RELDIR/.env'
  ln -sfn /opt/$NAME/shared/launch.sh '$RELDIR/launch.sh'
  if [ -d /opt/$NAME/app ] && [ ! -L /opt/$NAME/app ]; then
    mv /opt/$NAME/app /opt/$NAME/releases/legacy-\$(date +%s)
  fi
  ln -sfn '$RELDIR' /opt/$NAME/app.new && mv -T /opt/$NAME/app.new /opt/$NAME/app
  sudo systemctl restart $NAME-app"
# Poll for health up to 60s — a Next standalone cold boot routinely needs >4s;
# a single early sample read 'activating/000' and (correctly) failed a healthy
# deploy. Break on the first good sample; keep the last sample for the verdict.
status=inactive; code=000
for _ in $(seq 1 15); do
  sleep 4
  status=$(box "systemctl is-active $NAME-app 2>/dev/null" || true)
  code=$(box "curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:$PORT/ 2>/dev/null" || true)
  code="${code:-000}"
  [ "$status" = "active" ] && [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 400 ] && break
  [ "$status" = "failed" ] && break   # crash-loop: no point waiting the full window
done
echo "RESULT $NAME: systemd=$status http=$code release=$REL"

if [ "$status" = "active" ] && [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; then
  # Healthy — prune old releases, keep the newest 3 (current is among them).
  box "cd /opt/$NAME/releases && ls -1t | tail -n +4 | xargs -r rm -rf"
  exit 0
fi

# Unhealthy — auto-rollback to the previous release if one exists.
if [ -n "$PREV" ]; then
  echo "DEPLOY UNHEALTHY — rolling back to $PREV"
  box "ln -sfn '$PREV' /opt/$NAME/app.new && mv -T /opt/$NAME/app.new /opt/$NAME/app && sudo systemctl restart $NAME-app"
  sleep 4
  rb=$(box "systemctl is-active $NAME-app || true")
  echo "ROLLBACK $NAME: systemd=$rb → $PREV"
else
  echo "DEPLOY UNHEALTHY — no previous release to roll back to (first release-deploy)"
fi
exit 1
