#!/usr/bin/env bash
# install-backups.sh — box-wide Postgres backups for the bitbaum Hetzner box.
#
# WHY this is separate from install-hetzner-crons.sh: that script installs the
# Loki *app* janitors (it calls loki's /api/crons/* endpoints).
# Backups protect EVERY database on the box (Loki, OrangeCat, revampit +
# the 12 apps in apps.conf), so they're box-wide infra and live here next to
# sync-infra.sh / verify.sh.
#
# What it installs on the box (address SSOT: scripts/hetzner/_box-env.sh):
#   /opt/backups/pg-backup.sh            nightly dump-all-databases runner
#   /etc/systemd/system/pg-backup.{service,timer}   runs daily at 02:30 UTC
#   restic (apt)                         for the optional off-box push
#
# Two-phase by design:
#   Phase 1 (active immediately): every DB dumped to /opt/backups/pg with
#     KEEP_DAYS retention. Strictly better than today's zero — but it's the
#     SAME DISK, so it does NOT survive disk loss.
#   Phase 2 (off-box, opt-in): drop /opt/backups/restic.env on the box and the
#     runner pushes encrypted snapshots to a Hetzner Storage Box. See the
#     instructions printed at the end of this run.
#
# Idempotent — safe to re-run after a box rebuild or schedule change.
# Usage: bash scripts/hetzner/install-backups.sh

set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
HOST="$BOX_ROOT"

ssh -o BatchMode=yes "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
export LC_ALL=C

mkdir -p /opt/backups/pg
chmod 700 /opt/backups

# restic for the optional off-box push (Phase 2). Cheap to have ready.
if ! command -v restic >/dev/null 2>&1; then
  echo "→ installing restic..."
  DEBIAN_FRONTEND=noninteractive apt-get update -qq && \
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq restic >/dev/null && \
  echo "  restic installed" || echo "  WARN: restic install failed (Phase 1 still works)"
fi

# ── The backup runner ────────────────────────────────────────────────────────
cat > /opt/backups/pg-backup.sh <<'SH'
#!/usr/bin/env bash
# Box-wide Postgres backup. Installed by scripts/hetzner/install-backups.sh.
# Dumps every non-template DB (custom format) + global roles to /opt/backups/pg,
# prunes local copies older than KEEP_DAYS, and — only if /opt/backups/restic.env
# exists — pushes encrypted snapshots off-box via restic.
set -uo pipefail
export LC_ALL=C
# Every dump holds every row of a product (patients' and residents' data among
# them): readable by root only, from its first byte. /opt/backups is 700, but
# the files were 644 inside it (seen 2026-11-02: vitareba-…-023004.dump).
umask 077
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST=/opt/backups/pg
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$DEST"
log(){ echo "[pg-backup $STAMP] $*"; }

# Roles, grants, tablespaces — required for a from-scratch restore.
sudo -u postgres pg_dumpall --globals-only 2>/dev/null | gzip > "$DEST/globals-$STAMP.sql.gz"

mapfile -t DBS < <(sudo -u postgres psql -At -c \
  "SELECT datname FROM pg_database WHERE datistemplate=false AND datname<>'postgres'" 2>/dev/null)
log "dumping ${#DBS[@]} databases"
fail=0
for db in "${DBS[@]}"; do
  [ -z "$db" ] && continue
  if sudo -u postgres pg_dump -Fc "$db" > "$DEST/${db}-$STAMP.dump" 2>/dev/null; then
    log "ok $db ($(du -h "$DEST/${db}-$STAMP.dump" | cut -f1))"
  else
    log "FAIL $db"; rm -f "$DEST/${db}-$STAMP.dump"; fail=1
  fi
done

# Supabase stack lives in a SEPARATE Postgres (the supabase-db container, port 5433) that
# the box-system loop above CANNOT see — OrangeCat + any Supabase-stack app live in its
# `postgres` DB. Without this they had NO backup (the system "orangecat" DB was an empty
# stub). Dump the container DBs too.
if docker ps --format "{{.Names}}" 2>/dev/null | grep -qx supabase-db; then
  for sdb in postgres _supabase; do
    if docker exec supabase-db pg_dump -U postgres -Fc "$sdb" > "$DEST/supabase-${sdb}-$STAMP.dump" 2>/dev/null; then
      log "ok supabase/$sdb ($(du -h "$DEST/supabase-${sdb}-$STAMP.dump" | cut -f1))"
    else
      log "FAIL supabase/$sdb"; rm -f "$DEST/supabase-${sdb}-$STAMP.dump"; fail=1
    fi
  done
  # Cluster globals (roles/grants) of the CONTAINER cluster — pg_dump alone omits them;
  # without this a from-scratch pg_restore errors on supabase_realtime_admin /
  # supabase_functions_admin etc. (found by the 2026-07-03 restore drill).
  if docker exec supabase-db pg_dumpall -U supabase_admin --globals-only 2>/dev/null | gzip > "$DEST/supabase-globals-$STAMP.sql.gz" && [ -s "$DEST/supabase-globals-$STAMP.sql.gz" ]; then
    log "ok supabase/globals"
  else
    log "FAIL supabase/globals"; rm -f "$DEST/supabase-globals-$STAMP.sql.gz"; fail=1
  fi
fi

# Config + secrets snapshot (Phase 2b). The DB dumps alone CANNOT rebuild the box: a
# from-scratch restore also needs the Supabase stack .env (JWT_SECRET / ANON / SERVICE_ROLE
# / DB password), the app .env, the Caddyfile and the compose files. If those secrets are
# lost, a fresh Supabase mints NEW keys that won't match the restored app → auth breaks.
# Stage them with 600 perms into a dir that restic also pushes (encrypted at rest).
# See docs/operations/DISASTER_RECOVERY.md.
# SSOT-DISCOVERED from the filesystem (what's actually deployed), so it can't
# drift from a hand-maintained list. The old list captured only orangecat +
# supabase, so ~15 apps' .env secrets (NEXTAUTH/CRON/API keys — non-regenerable)
# were UNBACKED and the box was not rebuildable (found 2026-07-22).
CFG=/opt/backups/config
rm -rf "$CFG"; mkdir -p "$CFG"; chmod 700 "$CFG"   # clean so a removed app doesn't linger
stage(){ [ -e "$1" ] && install -D -m 600 "$1" "$2" && log "cfg ${2#"$CFG"/}"; }

# Every deployed app's LIVE secrets (releases layout → shared/.env; legacy → app/.env).
for name in $(ls -1 /opt 2>/dev/null); do
  for e in "/opt/$name/shared/.env" "/opt/$name/app/.env"; do
    [ -e "$e" ] && { install -D -m 600 "$e" "$CFG/apps/${name}.env"; log "cfg apps/${name}.env"; break; }
  done
done
# Non-app service envs
stage /opt/supabase/docker/.env    "$CFG/supabase.env"
stage /opt/loki/runner/.env  "$CFG/loki-runner.env"
# Caddy (main config + every app vhost)
stage /etc/caddy/Caddyfile "$CFG/caddy/Caddyfile"
for v in /etc/caddy/apps.d/*.caddy; do stage "$v" "$CFG/caddy/$(basename "$v")"; done
# Every loki-generated unit + drop-in + timer + launch script (regenerable
# from apps.conf, but cheap to snapshot so a restore is turnkey).
for u in /etc/systemd/system/*-app.service /etc/systemd/system/appcron-*.service /etc/systemd/system/appcron-*.timer; do
  stage "$u" "$CFG/systemd/$(basename "$u")"
done
for d in /etc/systemd/system/*-app.service.d/*.conf; do
  [ -e "$d" ] && stage "$d" "$CFG/systemd/$(basename "$(dirname "$d")").d__$(basename "$d")"
done
for l in /opt/*/shared/launch.sh /opt/*/app/launch.sh; do
  [ -e "$l" ] && { n=$(echo "$l" | sed -E 's#/opt/([^/]+)/.*#\1#'); stage "$l" "$CFG/apps/${n}-launch.sh"; }
done
# Whole monitoring stack — scripts + config + secrets (hcloud/telegram tokens are
# secrets → CFG is 700 + restic-encrypted). Filesystem-discovered so any new
# watcher/alert script is captured without editing this list. Restores turnkey:
# alerting + rescale-availability watch survive a full box rebuild.
for m in /opt/monitoring/*.sh /opt/monitoring/*.env /opt/monitoring/*.conf; do
  [ -e "$m" ] && stage "$m" "$CFG/monitoring/$(basename "$m")"
done
for u in /etc/systemd/system/host-check.* /etc/systemd/system/hcloud-availability.* /etc/systemd/system/notify-failure@.service; do
  [ -e "$u" ] && stage "$u" "$CFG/systemd/$(basename "$u")"
done
# Supabase stack topology
for f in /opt/supabase/docker/docker-compose*.yml; do stage "$f" "$CFG/$(basename "$f")"; done

# Local retention (same disk — Phase 1 safety net only).
find "$DEST" -type f \( -name '*.dump' -o -name '*.sql.gz' \) -mtime "+$KEEP_DAYS" -delete

# Off-box push (Phase 2 — only when configured). Pushes BOTH the DB dumps ($DEST) and the
# config/secret snapshot ($CFG) in one encrypted snapshot.
if [ -f /opt/backups/restic.env ]; then
  set -a; . /opt/backups/restic.env; set +a
  # Bounded: an unreachable target (seen 2026-11-02) held the run for 29
  # minutes before failing. Reachable is answered in seconds; the push of a
  # night's dumps and uploads gets an hour.
  if timeout 120 restic snapshots >/dev/null 2>&1 || timeout 120 restic init >/dev/null 2>&1; then
    # DB dumps + config/secrets + USER UPLOADS (medical docs, pet photos — on
    # local disk, previously NOT in any backup).
    BPATHS=("$DEST" "$CFG"); for u in /opt/*/uploads; do [ -d "$u" ] && BPATHS+=("$u"); done
    if timeout 3600 restic backup "${BPATHS[@]}" --tag pg --host bitbaum >/dev/null 2>&1; then
      log "restic push ok → $RESTIC_REPOSITORY"
      timeout 1800 restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune >/dev/null 2>&1 || true
    else
      log "ERROR: restic push failed — local dump kept"; fail=1
    fi
  else
    log "ERROR: restic repo unreachable — local dump kept, off-box skipped"; fail=1
  fi
else
  log "no /opt/backups/restic.env — LOCAL-ONLY backup (does NOT survive disk loss)"
fi
log "done: $(ls -1 "$DEST"/*-"$STAMP".* 2>/dev/null | wc -l) files; fail=$fail"
exit $fail
SH
chmod +x /opt/backups/pg-backup.sh

# ── systemd timer (daily 02:30 UTC) ──────────────────────────────────────────
cat > /etc/systemd/system/pg-backup.service <<'SVC'
[Unit]
Description=Box-wide Postgres backup (all databases)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/backups/pg-backup.sh
SVC

cat > /etc/systemd/system/pg-backup.timer <<'TIMER'
[Unit]
Description=Daily Postgres backup timer

[Timer]
OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=300
Persistent=true
Unit=pg-backup.service

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now pg-backup.timer >/dev/null 2>&1
echo "✓ pg-backup.timer installed:"
systemctl list-timers pg-backup.timer --all --no-pager | grep -E 'pg-backup|NEXT' || true

# First run now so we have a backup tonight even if the box reboots before 02:30,
# and so we prove the path works end-to-end.
echo "→ running first backup now..."
/opt/backups/pg-backup.sh || echo "  (see output above)"
echo "--- /opt/backups/pg ---"
ls -lh /opt/backups/pg | tail -n +2
REMOTE

cat <<NEXT

────────────────────────────────────────────────────────────────────────────
Phase 1 is LIVE: nightly dump of every database to /opt/backups/pg (02:30 UTC).
But that's the same disk — to survive disk loss, enable off-box (Phase 2):

1. Hetzner Console (https://console.hetzner.cloud) → Storage Boxes → create a
   BX11 box (~CHF 4/mo, 1 TB). Note its username (uXXXXXX) and host
   (uXXXXXX.your-storagebox.de).
2. Enable SSH on the Storage Box: Storage Box → Settings → "SSH support" ON.
3. Put root's key on it (one line, run locally):
     ssh-copy-id -p23 uXXXXXX@uXXXXXX.your-storagebox.de
   (or paste root@bitbaum's ~/.ssh/id_*.pub into the Storage Box → SSH keys UI)
4. On the box, create the config (replace uXXXXXX + pick a strong password,
   and SAVE the password somewhere safe — losing it means losing the backups):
     ssh $BOX_ROOT
     cat > /opt/backups/restic.env <<EOF
     export RESTIC_REPOSITORY="sftp:uXXXXXX@uXXXXXX.your-storagebox.de:/pg"
     export RESTIC_PASSWORD="<a-strong-passphrase>"
     EOF
     chmod 600 /opt/backups/restic.env
5. Prove it:  /opt/backups/pg-backup.sh   # should print "restic push ok"

Restore drill (do this once so you trust it):
     restic -r "\$RESTIC_REPOSITORY" snapshots
     restic -r "\$RESTIC_REPOSITORY" restore latest --target /tmp/restore
     sudo -u postgres pg_restore -d <db> --clean /tmp/restore/opt/backups/pg/<db>-*.dump
────────────────────────────────────────────────────────────────────────────
NEXT

