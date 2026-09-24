#!/usr/bin/env bash
# deploy-hetzner.sh — ship the production build to the bitbaum Hetzner box.
#
# The box serves Loki at https://loki.orangecat.ch (Caddy →
# 127.0.0.1:4002, systemd unit loki-app). Box-side .env, launch.sh and
# backups/ are owned by the box and never touched by a deploy.
#
# Also syncs + restarts loki-box-runner (the always-on cloud builder).
# First-time install: bash scripts/hetzner/install-box-runner.sh
#
# Usage:
#   bash scripts/deploy-hetzner.sh            # build + rsync + restart
#   bash scripts/deploy-hetzner.sh --no-build # rsync an existing build

set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/hetzner/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
HOST="$BOX_ROOT"
APP_DIR="/opt/loki/app"
# The box-runner's Unix owner. Defaults to ubuntu; set to fcrunner AFTER running
# migrate-box-runner-to-fcrunner.sh so the runner-code sync doesn't chown the
# dir back to ubuntu on every deploy. The app + bridge stay ubuntu-owned.
RUNNER_OWNER="${LOKI_RUNNER_OWNER:-ubuntu}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STANDALONE="$PROJECT_DIR/.next/standalone"

# Args:
#   --no-build     rsync the existing $STANDALONE as-is
#   --ref <sha>    only build+ship if the working tree is STILL on that commit
#                  (used by the push-deploy hook). `npm run build` always compiles
#                  the floating working tree, so a hook that fires after you've
#                  switched branches would otherwise ship the wrong ref (it once
#                  shipped an off-main feature branch to the box). An isolated
#                  worktree would be ideal but Turbopack rejects an out-of-root
#                  node_modules symlink, so we guard in-place instead: build only
#                  when HEAD == ref, and re-check HEAD after the build so a switch
#                  mid-build can't ship a torn tree. On drift we skip loudly
#                  rather than ship wrong code.
NO_BUILD=""; REF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) NO_BUILD=1; shift ;;
    --ref)      REF="${2:-}"; shift 2 ;;
    *)          shift ;;
  esac
done

# Normalize --ref to a full SHA: git_head returns 40 chars, and the pinned-deploy
# guard compares literally, so a short ref would always "mismatch" and skip.
if [ -n "$REF" ]; then
  REF="$(git -C "$PROJECT_DIR" rev-parse --verify --quiet "${REF}^{commit}")" \
    || { echo "✗ --ref does not resolve to a commit: $REF" >&2; exit 1; }
fi

# Alert the operator (Telegram) when a deploy fails or rolls back. A silently
# broken ship + a silent rollback both left the box in an unknown state with
# nobody told; this closes that loop. Reads the box's own bot creds and sends
# from the box. Best-effort — a failed alert never affects the deploy. The
# message is base64'd so arbitrary text survives the ssh boundary unquoted.
deploy_alert() {
  local b64; b64=$(printf '%s' "$1" | base64 -w0 2>/dev/null || printf '%s' "$1" | base64)
  ssh "$HOST" "bash -s" <<REMOTE 2>/dev/null || true
E=/opt/loki/app/.env
T=\$(grep -oP '^TELEGRAM_BOT_TOKEN=\K.*' "\$E" 2>/dev/null | tr -d '"')
C=\$(grep -oP '^APP_TELEGRAM_CHAT_ID=\K.*' "\$E" 2>/dev/null | tr -d '"')
MSG=\$(echo '$b64' | base64 -d)
[ -n "\$T" ] && [ -n "\$C" ] && curl -s -m 10 -o /dev/null \
  "https://api.telegram.org/bot\$T/sendMessage" \
  --data-urlencode "chat_id=\$C" \
  --data-urlencode "text=🚨 Loki deploy: \$MSG" || true
REMOTE
}

# ── Serialize deploys (fix: concurrent-build collision) ──────────────────────
# Two near-simultaneous pushes to main each background a deploy; without a lock
# both run `npm run build` in the shared .next tree and collide ("Another next
# build process is already running"), and the OLDER ref can win the race. A
# blocking lock serializes deploys so the NEWEST ref ships last; every step
# below is idempotent, so waiting is always safe.
LOCK_FILE="${LOKI_DEPLOY_LOCK:-/tmp/loki-deploy.lock}"
exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  if ! flock -w 900 9; then
    echo "✗ deploy: timed out after 15m waiting for an in-flight deploy — aborting" >&2
    exit 1
  fi
fi

# ── Deploy-result sink (fix: exit 0 masked failed deploys) ───────────────────
# The push-deploy hook backgrounds this script and its exit code dies in a
# detached log nobody reads. Record every outcome: a final status line, a
# desktop notification (best-effort), and a row in the box debug_logs so a
# failed deploy surfaces on /system instead of being invisible until a 503.
DEPLOY_REF_SHORT="$(git -C "$PROJECT_DIR" rev-parse --short "${REF:-HEAD}" 2>/dev/null || echo unknown)"

# Which phase we are in, so a deploy killed by `set -e` on a SILENT command
# still says where it died. #289 fixed one such command; this makes the next
# one diagnosable instead of a fresh investigation. The marker read failed with
# both streams redirected to /dev/null, so the entire trace was
# "deploy FAILED (exit 1)" plus a path to a log on an ephemeral CI runner —
# which is not a diagnosis. Naming the step costs one variable.
DEPLOY_STEP="starting"
step() { DEPLOY_STEP="$1"; }

report_deploy_status() {
  local code=$?
  local level msg
  if [ "$code" = 0 ]; then
    level=info; msg="deploy OK: ${DEPLOY_REF_SHORT} to Hetzner"
  else
    level=error; msg="deploy FAILED (exit ${code}) during [${DEPLOY_STEP}]: ${DEPLOY_REF_SHORT} — see /tmp/push-deploy-loki.log"
  fi
  echo "→ ${msg}"
  command -v notify-send >/dev/null 2>&1 && notify-send "Loki deploy" "$msg" >/dev/null 2>&1 || true
  # Durable record in the box DB — best-effort, must never change the exit code.
  # msg is fixed text + a short SHA (no single-quotes), so it is SQL-safe here.
  ssh -o ConnectTimeout=10 "$HOST" "LC_ALL=C bash -s" >/dev/null 2>&1 <<REMOTE || true
DBURL=\$(grep -oP '^DATABASE_URL=\K.*' /opt/loki/app/.env 2>/dev/null | head -1 | tr -d '"')
[ -n "\$DBURL" ] && psql "\$DBURL" -q -c "insert into debug_logs (source, level, message) values ('deploy', '${level}', '${msg}')" 2>/dev/null
REMOTE
}
trap report_deploy_status EXIT

git_head() { git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || echo unknown; }

# Off-main gate — prod may only ever run a commit contained in origin/main.
# Runs FIRST, before the schema step mutates anything: a refused deploy must
# leave the box exactly as it found it. See the script for the two incidents
# that made this an enforced invariant rather than a remembered rule.
step "off-main gate"
bash "$SCRIPT_DIR/ci/check-deploy-ref.sh" "$PROJECT_DIR" "${REF:-HEAD}"

# Schema BEFORE build (same order as scripts/hetzner/deploy.sh): guarded,
# forward-only drizzle migrations from ./drizzle via the shared applier — the
# first run baselines the existing file set against the live loki DB. The
# applier is filename-based, so it's immune to journal/snapshot state.
# drizzle/meta now HAS a current-schema snapshot (0039) with an idx-aligned
# journal, so `npm run db:generate` diffs and emits the next 0040+ migration
# automatically — no more hand-written DDL (that reflex caused the box-DDL
# ownership rollbacks; see scripts/db/apply-box.sh).
step "schema migration"
bash "$SCRIPT_DIR/hetzner/apply-schema.sh" loki "$PROJECT_DIR" loki "." \
  || { echo "✗ schema step failed — deploy aborted (no code shipped)" >&2; exit 1; }

# Ownership self-heal: apply-schema.sh (shared infra) runs DDL as the postgres
# superuser, so a freshly-migrated table would be owned by postgres and thus
# INVISIBLE to the loki app role (privilege-filtered information_schema) —
# the exact class that rolled back deploys. Idempotent reassignment: on a healthy
# box this touches zero tables; when a new migration created a postgres-owned
# object, it hands ownership to the app role before the drift-check runs.
DBURL_OWN=$(ssh "$HOST" "grep -oP '^DATABASE_URL=\K.*' /opt/loki/app/.env 2>/dev/null | head -1 | tr -d '\"'")
if [ -n "$DBURL_OWN" ]; then
  APP_ROLE=$(printf '%s' "$DBURL_OWN" | sed -E 's#^[^/]*//([^:]+):.*#\1#')
  ssh "$HOST" "sudo -u postgres psql -d loki -v ON_ERROR_STOP=1 -q -c \"DO \\\$\\\$ DECLARE r record; n int := 0; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner <> '${APP_ROLE}' LOOP EXECUTE format('ALTER TABLE public.%I OWNER TO ${APP_ROLE}', r.tablename); n := n + 1; END LOOP; IF n > 0 THEN RAISE NOTICE 'reassigned % table(s) to ${APP_ROLE}', n; END IF; END \\\$\\\$;\"" \
    && echo "  ✓ table ownership reconciled to ${APP_ROLE}" \
    || echo "  ⚠ ownership reconcile skipped (non-fatal)"
fi

if [ -n "$NO_BUILD" ]; then
  :  # reuse the existing $STANDALONE
elif [ -n "$REF" ]; then
  CURRENT="$(git_head)"
  if [ "$CURRENT" != "$REF" ]; then
    echo "✗ pinned deploy SKIPPED — working tree is on ${CURRENT:0:12}, not the pushed ref ${REF:0:12}."
    echo "  A backgrounded push-deploy must not build whatever branch you've since switched to."
    echo "  Deploy it explicitly: git checkout ${REF:0:12} && bash scripts/deploy-hetzner.sh   (or push from main again)"
    exit 1
  fi
  # Pass the pinned ref into the build env so the postbuild (deploy-local.sh)
  # gates the LOCAL systemd restart on it too. Without this, a HEAD switch
  # mid-build is caught here (box rsync aborts) but the postbuild has already
  # restarted the local prod service with the torn build — the box was protected
  # but local was not. Now a drifted pinned build restarts nothing, anywhere.
  (cd "$PROJECT_DIR" && LOKI_DEPLOY_REF="$REF" pnpm run build)
  AFTER="$(git_head)"
  if [ "$AFTER" != "$REF" ]; then
    echo "✗ pinned deploy ABORTED — HEAD moved to ${AFTER:0:12} during the build; not shipping a torn tree (local restart was skipped too)." >&2
    exit 1
  fi
else
  (cd "$PROJECT_DIR" && pnpm run build)
fi

if [ -z "$NO_BUILD" ]; then
  (cd "$PROJECT_DIR" && pnpm -C bridge run build)
fi

if [ ! -d "$STANDALONE/.next/static" ]; then
  echo "✗ $STANDALONE missing static assets — run pnpm run build first" >&2
  exit 1
fi

# ── Regression guard: never ship a commit that is BEHIND what is already live ──
#
# This script ships whatever the working tree is on, and the box accepts it
# without question — so a deploy run from a stale checkout silently rolls
# production back. It has done so repeatedly (see the comment in
# src/app/api/health/route.ts). Most recently on 2026-08-15: CI shipped and
# verified main at 09:48, and ten minutes later a hand-run deploy replaced it
# with a tree ~25 commits old. The build-ref marker made that *visible* — it is
# how this was found — but visibility after the fact is not prevention.
#
# The box's marker is the SSOT for what is running. If that commit is an
# ancestor of what we are about to ship, this is a fast-forward and safe.
# Anything else moves production backwards, or sideways onto an unrelated
# branch, and is refused. ALLOW_ROLLBACK=1 is the deliberate override for a
# genuine rollback.
# Every command here must be non-fatal under `set -euo pipefail`. Reading the
# marker is a QUESTION, not a step of the deploy: if the box has no .build-ref
# then `cat` exits 1, `pipefail` makes the whole substitution non-zero, and
# `set -e` kills the deploy — with no message at all, because the guard that
# would have explained itself never ran. That is exactly what happened: two
# deploys died silently between "table ownership reconciled" and the snapshot.
# `|| true` on BOTH sides (remote command and local substitution) keeps an
# unanswerable question from becoming a failed deploy; check-not-behind.sh
# already treats an empty marker as "cannot tell — ship anyway".
step "reading the live build marker"
SHIPPING_SHA="$(git -C "$PROJECT_DIR" rev-parse "${REF:-HEAD}" 2>/dev/null || echo "")"
LIVE_REF_NOW="$(ssh "$HOST" "cat '$APP_DIR/.build-ref' 2>/dev/null || true" 2>/dev/null | tr -d '[:space:]' || true)"
bash "$PROJECT_DIR/scripts/ci/check-not-behind.sh" "$LIVE_REF_NOW" "$SHIPPING_SHA" "$PROJECT_DIR" || exit 1

# Snapshot the current box build for one-command rollback (fix: in-place rsync
# left no way back from a broken restart). Excludes backups/ so we don't copy
# the dump store every deploy; .env + launch.sh ARE snapshotted so a rollback
# restores a coherent tree.
echo "→ snapshot current box build → $APP_DIR.prev"
ssh "$HOST" "test -d '$APP_DIR' && rsync -a --delete --exclude backups '$APP_DIR/' '$APP_DIR.prev/'" \
  || echo "  (no prior build to snapshot)"

# Restore the previous build if a ship fails its restart/verification, so a
# broken deploy doesn't strand the box. --delete but --exclude backups, so the
# dump store is never touched; .env/launch.sh come from the snapshot.
rollback_box() {
  local why="${1:-deploy failed}"
  echo "↩ deploy failed after ship — rolling box back to previous build" >&2
  if ssh "$HOST" "test -d '$APP_DIR.prev' \
    && rsync -a --delete --exclude backups '$APP_DIR.prev/' '$APP_DIR/' \
    && chown -R ubuntu:ubuntu '$APP_DIR' \
    && systemctl restart loki-app && sleep 3 \
    && systemctl is-active loki-app >/dev/null"; then
    echo "  ✓ rolled back to previous build" >&2
    deploy_alert "❌ $why — auto-rolled back to the previous build. Box is serving the last-good version; the ship was aborted."
  else
    echo "  ✗ ROLLBACK FAILED — box needs manual attention" >&2
    deploy_alert "🔥 $why AND ROLLBACK FAILED — the box needs manual attention NOW ($APP_DIR may be in a torn state)."
  fi
}

# Keepalive on the rsync transport: without it a dead TCP connection wedges the
# transfer indefinitely (observed a 15-min stall at 0 bytes/s with the box fully
# reachable). ServerAlive drops the channel after ~90s of silence so the deploy
# fails fast and can be rerun, rather than hanging past every timeout below.
RSYNC_SSH="ssh -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=6"
step "rsync to box"
echo "→ rsync standalone → $HOST:$APP_DIR"
rsync -az --delete -e "$RSYNC_SSH" \
  --exclude '.env' \
  --exclude 'launch.sh' \
  --exclude 'backups' \
  "$STANDALONE/" "$HOST:$APP_DIR/"

echo "→ restart loki-app on box"
# timeout: this ssh once hung for 47 minutes AFTER the restart completed on
# the box (channel never closed), freezing the deploy before verification and
# the runner sync — the push looked deployed but the runner kept old code.
# Every step below this one is idempotent, so a killed-and-rerun deploy is
# always safe; a silently hung one is not.
if ! timeout 180 ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=6 "$HOST" \
  "chown -R ubuntu:ubuntu $APP_DIR \
  && systemctl restart loki-app \
  && sleep 3 \
  && systemctl is-active loki-app >/dev/null"; then
  echo "✗ restart failed on box" >&2; rollback_box "loki-app failed to restart"; exit 1
fi

# Post-deploy verification — fails the deploy LOUDLY instead of shipping a
# silently-broken auth/email config, and rolls back. Catches the X-saga
# failure mode: a provider silently un-mounting when its env keys go missing.
#
# The /sign-in check POLLS for readiness (up to ~20s) rather than curling once:
# a slow-to-stop old Next process pushes the new one's first-accept past the
# restart's `sleep 3`, and a single immediate curl then failed the deploy and
# rolled back a build that was actually fine. Poll until the server accepts, and
# only then run the (one-shot) health/provider assertions.
echo "→ post-deploy verification"
if ! ssh "$HOST" 'set -e
  base=http://127.0.0.1:4002
  code=000
  for i in $(seq 1 20); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$base/sign-in" || echo 000)
    [ "$code" = 200 ] && break
    sleep 1
  done
  echo "  /sign-in: $code"; [ "$code" = 200 ] || { echo "  ✗ sign-in not 200 after 20s"; exit 1; }
  # /api/health returns 503 when env.ts finds a fatal/error config issue
  hcode=$(curl -s -o /dev/null -w "%{http_code}" "$base/api/health")
  echo "  /api/health: $hcode"; [ "$hcode" = 200 ] || { echo "  ✗ env health degraded — see debug_logs source=instrumentation/env"; exit 1; }
  # Expected auth providers must actually be mounted (not just env-gated in the UI)
  prov=$(curl -s "$base/api/auth/providers")
  for p in github google x-1a email-password; do
    grep -q "\"$p\"" <<<"$prov" || { echo "  ✗ auth provider missing: $p"; exit 1; }
  done
  echo "  ✓ providers mounted: github google x-1a email-password"'; then
  echo "✗ post-deploy verification failed" >&2; rollback_box "post-deploy verification failed (sign-in / health / providers)"; exit 1
fi

# Schema-drift guard against the BOX database. The pre-push check (scripts/
# check-schema-drift.ts) runs against the laptop DB; the box has its own
# Postgres, so a table/column added in code but never pushed there silently
# 500s the first feature that queries it. Print the schema-declared tables and
# columns here, fetch the box's tables/columns over ssh, and diff — fail LOUDLY
# instead of trusting a half-broken deploy.
echo "→ schema-drift check (box DB)"
# LC_ALL=C on EVERY sort and comm below: `comm` requires its inputs sorted in
# the same collation it verifies with, and glibc UTF-8 locales (e.g. de_CH.UTF-8)
# order some `table.column` strings inconsistently — `sort` produces output that
# `comm` then rejects as "not in sorted order", exit 1. Under set -euo pipefail
# that aborted the whole deploy (skipping the bridge sync) even though the box
# schema was fine. Byte-order collation is deterministic and self-consistent.
DECLARED=$(cd "$PROJECT_DIR" && npx tsx scripts/check-schema-drift.ts --print 2>/dev/null | LC_ALL=C sort)
DECLARED_COLUMNS=$(cd "$PROJECT_DIR" && npx tsx scripts/check-schema-drift.ts --print-columns 2>/dev/null | LC_ALL=C sort)
BOX_TABLES=$(ssh "$HOST" 'LC_ALL=C bash -s' <<'REMOTE' | LC_ALL=C sort
DBURL=$(grep -oP '^DATABASE_URL=\K.*' /opt/loki/app/.env 2>/dev/null | head -1 | tr -d '"')
psql "$DBURL" -t -A -c "select table_name from information_schema.tables where table_schema = 'public'" 2>/dev/null
REMOTE
)
BOX_COLUMNS=$(ssh "$HOST" 'LC_ALL=C bash -s' <<'REMOTE' | LC_ALL=C sort
DBURL=$(grep -oP '^DATABASE_URL=\K.*' /opt/loki/app/.env 2>/dev/null | head -1 | tr -d '"')
psql "$DBURL" -t -A -c "select table_name || '.' || column_name from information_schema.columns where table_schema = 'public'" 2>/dev/null
REMOTE
)
MISSING=$(LC_ALL=C comm -23 <(printf '%s\n' "$DECLARED") <(printf '%s\n' "$BOX_TABLES"))
MISSING_COLUMNS=$(LC_ALL=C comm -23 <(printf '%s\n' "$DECLARED_COLUMNS") <(printf '%s\n' "$BOX_COLUMNS"))
if [ -n "$MISSING" ] || [ -n "$MISSING_COLUMNS" ]; then
  echo "  ✗ box DB is missing declared tables:"
  [ -n "$MISSING" ] && printf '%s\n' "$MISSING" | sed 's/^/    - /' || echo "    - none"
  echo "  ✗ box DB is missing declared columns:"
  [ -n "$MISSING_COLUMNS" ] && printf '%s\n' "$MISSING_COLUMNS" | sed 's/^/    - /' || echo "    - none"
  echo "  → run 'DATABASE_URL=<box> npx drizzle-kit push' before trusting this deploy"
  # The app is already live at this point but is missing tables/columns the new
  # code needs — it will 500 on those features. Roll back to the last-good build
  # (whose schema matched the box) and alert, rather than serve a half-broken app.
  # Schema application stays a deliberate manual step: auto-applying DDL to prod
  # (drops included) is not worth the blast radius; the gate + rollback is safe.
  rollback_box "box DB is missing declared tables/columns — schema not pushed"
  exit 1
fi
echo "  ✓ schema: all $(printf '%s\n' "$DECLARED" | grep -c .) declared tables and $(printf '%s\n' "$DECLARED_COLUMNS" | grep -c .) declared columns present on box"

# Does the LIVE box report the commit we just shipped? Everything above proves
# the box is healthy; nothing above proves it is running THIS build. A stale
# rsync, a rotated-back app dir, or a second deploy landing behind this one all
# leave a green verification and the wrong code serving — which is exactly how
# the same build got rolled back three times without anyone noticing. The
# marker comes from scripts/record-build-ref.sh via /api/health.
SHIPPED_SHA="$(git -C "$PROJECT_DIR" rev-parse "${REF:-HEAD}" 2>/dev/null || echo "")"
LIVE_SHA="$(ssh "$HOST" "curl -s --max-time 5 http://127.0.0.1:4002/api/health" 2>/dev/null \
  | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p')"
if [ -z "$LIVE_SHA" ]; then
  # Pre-marker builds report no commit. Warn, never block: a deploy that is
  # otherwise verified must not fail because the PREVIOUS build lacked a stamp.
  echo "  ⚠ live build reports no commit — build-ref marker absent (pre-#279 build?)"
elif [ "$LIVE_SHA" != "$SHIPPED_SHA" ]; then
  # Loud, but NOT a rollback. The realistic cause is another deploy landing
  # behind this one — and reverting to app.prev would then throw away the newer
  # build, turning a benign race into the exact incident this check exists to
  # catch. The app is up and healthy; what was missing before was ever being
  # TOLD that the box is serving something else. Now it says so, and
  # /api/health answers it afterwards without an ssh session.
  echo "  ⚠ live build is ${LIVE_SHA:0:12}, but this deploy shipped ${SHIPPED_SHA:0:12}" >&2
  echo "    The box is not serving what was just built — another deploy raced this one," >&2
  echo "    or the rsync did not take. Confirm before trusting prod:" >&2
  echo "      curl -s https://loki.orangecat.ch/api/health" >&2
  echo "      git log --oneline -1 ${LIVE_SHA:0:12}" >&2
else
  echo "  ✓ live build is ${LIVE_SHA:0:12} — the commit this deploy shipped"
fi

echo "✓ deployed $(git -C "$PROJECT_DIR" rev-parse --short "${REF:-HEAD}") to Hetzner — verified"

# Event bridge — separate from the Next app and runner, but part of the same
# control-plane protocol. Sync it here so SSE/rawkey/presence contracts cannot
# drift between deploys.
BRIDGE_DIR="/opt/loki/bridge"
echo "→ sync event bridge → $HOST:$BRIDGE_DIR"
rsync -az --delete --no-perms --omit-dir-times -e "$RSYNC_SSH" \
  --exclude '.env' \
  --exclude 'node_modules' \
  "$PROJECT_DIR/bridge/" "$HOST:$BRIDGE_DIR/"
ssh "$HOST" "chown -R ubuntu:ubuntu $BRIDGE_DIR \
  && systemctl restart loki-bridge \
  && sleep 2 \
  && systemctl is-active loki-bridge >/dev/null"
echo "  ✓ loki-bridge active"

# Cloud builder (box-runner) — separate systemd unit from loki-app so app
# deploys never kill running agent PTYs. Still sync runner code on every ship
# so poller/pty-runtime fixes reach the always-on executor.
RUNNER_DIR="/opt/loki/runner"
echo "→ sync box-runner code → $HOST:$RUNNER_DIR"

# Track whether runner code actually changed. A systemd restart of the runner
# kills its whole cgroup — including any claude/hermes the runner launched for a
# live dispatch (a review run died this way, and every app-only deploy used to
# restart the runner for nothing). So: only restart when runner code moved, and
# drain in-flight agents first when it did.
RUNNER_CHANGED=0
sync_runner() {
  local out
  out=$(rsync -azi --no-perms --omit-dir-times -e "$RSYNC_SSH" "$@" 2>/dev/null) || return 0
  grep -qE '^[<>ch]f' <<<"$out" && RUNNER_CHANGED=1
  return 0
}
sync_runner "$PROJECT_DIR/src/" "$HOST:$RUNNER_DIR/src/"
sync_runner "$PROJECT_DIR/desktop/src/" "$HOST:$RUNNER_DIR/desktop/src/"
# box-runner reads its version from desktop/package.json — ship it alongside.
sync_runner "$PROJECT_DIR/desktop/package.json" "$HOST:$RUNNER_DIR/desktop/"
sync_runner "$PROJECT_DIR/home/" "$HOST:$RUNNER_DIR/home/"
sync_runner "$PROJECT_DIR/scripts/box-runner.ts" \
  "$PROJECT_DIR/scripts/mint-box-runner-token.ts" \
  "$PROJECT_DIR/scripts/reindex-knowledge.ts" \
  "$PROJECT_DIR/scripts/hosted-runner.ts" \
  "$PROJECT_DIR/scripts/hermes-dispatch.ts" \
  "$PROJECT_DIR/scripts/new-site-dispatch.ts" \
  "$HOST:$RUNNER_DIR/scripts/"
# The deferred-restart script must reach the box BEFORE it is invoked below.
sync_runner "$PROJECT_DIR/scripts/hetzner/drain-and-restart-runner.sh" \
  "$HOST:$RUNNER_DIR/scripts/"
sync_runner "$PROJECT_DIR/tsconfig.json" "$HOST:$RUNNER_DIR/tsconfig.json"

# Dependencies ship WITH the code that imports them. Until now the runner's
# src/ was re-synced every deploy while its package.json was whatever the
# original provisioning installed — so the moment a file under src/ gained a
# new import, the runner broke at its next run and said nothing. Observed
# 2026-08-24: loki-reindex had been dying nightly at 03:30 on
# `Cannot find module 'bip-kit'`, imported via src/lib/thoughts-content.ts,
# because the box manifest still listed 31 deps and never learned about it.
RUNNER_MANIFEST_CHANGED=0
manifest_out=$(rsync -azi --no-perms --omit-dir-times -e "$RSYNC_SSH" \
  "$PROJECT_DIR/package.json" "$PROJECT_DIR/package-lock.json" \
  "$HOST:$RUNNER_DIR/" 2>/dev/null) || manifest_out=""
grep -qE '^[<>ch]f' <<<"$manifest_out" && RUNNER_MANIFEST_CHANGED=1
# package.json carries `"@orangecat/sdk": "file:vendor/…tgz"`, so the tarball is
# part of the manifest: bump its version without shipping the file and the
# install fails on the box for a path that exists only here.
vendor_out=$(rsync -azi --no-perms --omit-dir-times -e "$RSYNC_SSH" \
  "$PROJECT_DIR/vendor/" "$HOST:$RUNNER_DIR/vendor/" 2>/dev/null) || vendor_out=""
grep -qE '^[<>ch]f' <<<"$vendor_out" && RUNNER_MANIFEST_CHANGED=1

ssh "$HOST" "chown -R $RUNNER_OWNER:$RUNNER_OWNER $RUNNER_DIR/src $RUNNER_DIR/desktop $RUNNER_DIR/home $RUNNER_DIR/scripts $RUNNER_DIR/tsconfig.json"

if [ "$RUNNER_MANIFEST_CHANGED" = "1" ]; then
  echo "→ runner manifest changed — installing dependencies"
  # `npm install`, deliberately NOT `npm ci`: ci deletes node_modules wholesale,
  # and for the window that takes, node_modules/.bin/tsx does not exist — which
  # is the runner's own ExecStart. Incremental install keeps the always-on
  # executor runnable throughout.
  #
  # And NOT --omit=dev: tsx is a devDependency here, so pruning dev deps would
  # delete the very binary that starts the runner and the reindex timer.
  step "runner dependencies"
  # Fail the deploy rather than ship a runner whose imports it may not have.
  # The alternative — warn and continue — is how this bug stayed invisible for
  # weeks in the first place: the runner was broken and the deploy said green.
  # HUSKY=0 is required, not cosmetic: package.json's `prepare` script runs
  # husky, the runner dir is not a git repo, and without the opt-out the
  # install exits 127 — which (correctly) would fail every deploy from here on.
  ssh "$HOST" "cd $RUNNER_DIR && HUSKY=0 npm install --no-audit --no-fund --silent" \
    || { echo "  ✗ runner dependency install FAILED — refusing to report a green deploy over a runner missing its imports" >&2; exit 1; }
  ssh "$HOST" "chown -R $RUNNER_OWNER:$RUNNER_OWNER $RUNNER_DIR/node_modules $RUNNER_DIR/package.json $RUNNER_DIR/package-lock.json" || true
  echo "  ✓ runner dependencies installed"
  RUNNER_CHANGED=1   # new deps only take effect in a fresh process
else
  echo "  ✓ runner manifest unchanged — dependency install skipped"
fi

# The runner restart waits for in-flight agents — but it waits ON THE BOX, in a
# detached transient unit, not here.
#
# This loop used to run inside the deploy: 480 of the ship step's 570 seconds
# were spent watching one agent that never finished, after which it restarted
# anyway. The web app had been live and verified for eight minutes by then. Two
# separate systems with opposite needs were sharing one job's wall-clock: the
# app wants to be live now, the runner wants to not kill anyone's work.
#
# Decoupled, both get what they want. The deploy ends when the app is verified;
# the box waits as long as it needs (30m cap, not 8) and restarts when the
# runner is genuinely idle. `systemd-run` detaches it into its own cgroup, so it
# survives this ssh closing and cannot be killed by the restart it performs.
step "scheduling runner restart"
if [ "$RUNNER_CHANGED" = 1 ]; then
  echo "→ runner code changed — scheduling a drain-then-restart on the box"
  # Newest intent wins: a previous deploy's pending restart is superseded by
  # this one, which is already syncing newer code.
  ssh "$HOST" "
    systemctl stop loki-runner-restart.service 2>/dev/null || true
    systemctl reset-failed loki-runner-restart.service 2>/dev/null || true
    systemd-run --unit=loki-runner-restart --collect --quiet \
      --description='Loki: restart box-runner once agents drain' \
      /bin/bash $RUNNER_DIR/scripts/drain-and-restart-runner.sh
  " && echo "  ✓ restart scheduled — runs when the runner goes idle (journal: -t loki-drain)" \
    || echo "  ⚠ could not schedule the runner restart — runner keeps old code until the next deploy" >&2
else
  echo "  ✓ runner code unchanged — restart skipped (in-flight agents undisturbed)"
fi
