#!/usr/bin/env bash
# Safe disk reclaim on the bitbaum box. Piped to `bash -s` as root from
# .github/workflows/disk-cleanup.yml (same SSH setup as box-doctor.yml).
#
# Usage: disk-cleanup.sh [0|1]
#   1 = dry run (inventory + planned deletions, changes nothing)
#   0 = real run
#
# Scope (current + previous release of every app is kept):
#   1. journal vacuum to 200M + apt-get clean
#   2. npm caches for ubuntu, openclaw, root
#   3. /opt/*/releases entries beyond the two newest
#   4. unreferenced docker images and build cache older than 7 days
#      (NOT volumes, NOT running containers)
#   5. rotated /var/log/*.gz older than 14 days
#   6. /opt/backups/pg dumps older than 14 days (KEEP_DAYS policy)
#   7. only if still above 80%: node_modules of /home/ubuntu/dev checkouts
#      idle ≥14 days and not in use
#   Tier 8 (~/.cache / Playwright) is deliberately not in this script.
#
# Stops as soon as df Use% for / is at or below 75%.
#
# NEVER touches: Docker volumes, Postgres data, running containers,
# /opt/*/shared, the live /opt/*/app target, the previous release
# (app.prev / app-old / the second-newest releases/ dir), backups from
# the last 14 days, or the disk size itself.
#
# THE REPO IS PUBLIC and run logs are too: print sizes, counts, and paths
# that are already in the register, never file contents, env, or keys.
set -uo pipefail

DRY="${1:-1}"
TARGET_PCT=75
TIER7_PCT=80
KEEP_RELEASES=2
KEEP_BACKUP_DAYS=14
DOCKER_KEEP_HOURS=168
IDLE_DAYS=14
DEV_ROOT="/home/ubuntu/dev"

if [ "$DRY" != "0" ] && [ "$DRY" != "1" ]; then
  echo "usage: $0 [0|1]  (1=dry-run, 0=real)" >&2
  exit 2
fi

# A size, or "over ${DU_BUDGET}s" when counting takes too long to be worth it.
#
# The first run of this script (2026-11-11, dry) was cancelled at the
# workflow's 30 minutes having printed four sizes and planned nothing: `du`
# on /opt alone took 14 minutes on a disk full of node_modules. Sizes here
# are for the reader; what was freed is measured from df, which is instant.
# So a size that cannot be had quickly is skipped rather than waited for.
DU_BUDGET=45
sz() {
  local out
  out="$(timeout "$DU_BUDGET" du -sh "$1" 2>/dev/null | awk '{print $1}')"
  echo "${out:-over ${DU_BUDGET}s}"
}

pct() { df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9'; }
used_k() { df --output=used / 2>/dev/null | tail -1 | tr -dc '0-9'; }

start_pct="$(pct)"
start_used="$(used_k)"
FREED_SUMMARY=""
note() { FREED_SUMMARY="${FREED_SUMMARY}${FREED_SUMMARY:+; }$1"; }

echo "=== disk-cleanup dry_run=$DRY  $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "target: stop at or below ${TARGET_PCT}%; start ${start_pct}%  used_k=${start_used}"
echo

echo "=== df -h (before) ==="
df -h
echo
echo "=== docker system df (before) ==="
if command -v docker >/dev/null 2>&1; then
  docker system df || true
else
  echo "docker not installed"
fi
echo

echo "=== journal disk usage ==="
journalctl --disk-usage 2>/dev/null || true
echo

echo "=== hotspot sizes ==="
for hot in /var/lib/docker /var/lib/containerd /var/log /opt /opt/backups /opt/backups/pg \
  /home/ubuntu /home/ubuntu/dev /home/ubuntu/.loki /home/ubuntu/.cache /home/ubuntu/.npm \
  /home/ubuntu/.local /var/cache/apt /usr /swapfile; do
  [ -e "$hot" ] && printf '%s\t%s\n' "$(sz "$hot")" "$hot"
done
echo
echo "=== /opt per entry ==="
for entry in /opt/*; do
  [ -e "$entry" ] && printf '%s\t%s\n' "$(sz "$entry")" "$entry"
done | sort -h
echo

echo "=== release dirs (newest first; keep ${KEEP_RELEASES}) ==="
for reldir in /opt/*/releases; do
  [ -d "$reldir" ] || continue
  count="$(ls -1 "$reldir" 2>/dev/null | wc -l | tr -d ' ')"
  echo "-- $reldir  ($count entries, $(sz "$reldir"))"
  i=0
  ls -1t "$reldir" 2>/dev/null | while read -r name; do
    [ -n "$name" ] || continue
    i=$((i + 1))
    tag="KEEP"
    [ "$i" -gt "$KEEP_RELEASES" ] && tag="PRUNE"
    printf '  %s  %s  %s\n' "$tag" "$(sz "$reldir/$name")" "$name"
  done
done
echo

echo "=== app / previous release pointers ==="
for d in /opt/*/app /opt/*/app.prev /opt/*/app-old; do
  [ -e "$d" ] || continue
  target="$(readlink -f "$d" 2>/dev/null || echo not-a-link)"
  size="$(sz "$d")"
  printf '  %s -> %s  %s\n' "$d" "$target" "$size"
done
echo

echo "=== backups in /opt/backups/pg (counts and sizes only) ==="
if [ -d /opt/backups/pg ]; then
  total_n="$(find /opt/backups/pg -maxdepth 1 -type f \( -name '*.dump' -o -name '*.sql.gz' \) | wc -l | tr -d ' ')"
  old_n="$(find /opt/backups/pg -maxdepth 1 -type f \( -name '*.dump' -o -name '*.sql.gz' \) -mtime +${KEEP_BACKUP_DAYS} | wc -l | tr -d ' ')"
  total_sz="$(sz /opt/backups/pg)"
  old_sz="$(find /opt/backups/pg -maxdepth 1 -type f \( -name '*.dump' -o -name '*.sql.gz' \) -mtime +${KEEP_BACKUP_DAYS} -printf '%s\n' 2>/dev/null | awk '{s+=$1} END {if(s<1024*1024) printf "%dK\n", s/1024; else printf "%dM\n", s/1024/1024}')"
  echo "  files=$total_n size=$total_sz  older_than_${KEEP_BACKUP_DAYS}d=$old_n size=${old_sz:-0}"
else
  echo "  /opt/backups/pg is missing"
fi
echo

echo "=== timer diagnosis ==="
for unit in disk-gc.timer disk-gc.service pg-backup.timer pg-backup.service; do
  echo "-- $unit"
  echo "  enabled=$(systemctl is-enabled "$unit" 2>&1 || true)  active=$(systemctl is-active "$unit" 2>&1 || true)"
done
echo "-- disk-gc.timer list"
systemctl list-timers disk-gc.timer pg-backup.timer --all --no-pager 2>/dev/null || true
echo "-- /opt/monitoring/disk-gc.sh exists? $([ -x /opt/monitoring/disk-gc.sh ] && echo yes || echo NO)"
echo "-- /opt/backups/pg-backup.sh exists? $([ -x /opt/backups/pg-backup.sh ] && echo yes || echo NO)"
if [ -f /opt/backups/pg-backup.sh ]; then
  grep -E '^KEEP_DAYS=' /opt/backups/pg-backup.sh || true
fi
echo "-- recent disk-gc journal (last 30 lines)"
journalctl -u disk-gc -n 30 --no-pager -o short-iso 2>/dev/null || true
echo "-- recent pg-backup journal (last 20 lines, no paths of dumps)"
journalctl -u pg-backup -n 20 --no-pager -o short-iso 2>/dev/null | sed -E 's#/opt/backups/pg/[^ ]+#/opt/backups/pg/<file>#g' || true
echo

at_or_below_target() { [ "$(pct)" -le "$TARGET_PCT" ]; }

run_or_echo() {
  # $1 = description; remaining args are the command
  local desc="$1"; shift
  if [ "$DRY" = "1" ]; then
    echo "DRY: $desc"
    return 0
  fi
  echo "RUN: $desc"
  "$@"
}

# Enable a timer only when the unit exists and is simply disabled/inactive,
# not when the unit file is missing or the service is failed in a way that
# needs a human.
maybe_enable_timer() {
  local timer="$1"
  if ! systemctl cat "$timer" >/dev/null 2>&1; then
    echo "TIMER: $timer is not installed (unit file missing) — not inventing it here"
    note "$timer missing"
    return 0
  fi
  local enabled active
  enabled="$(systemctl is-enabled "$timer" 2>/dev/null || true)"
  active="$(systemctl is-active "$timer" 2>/dev/null || true)"
  if [ "$enabled" = "enabled" ] && [ "$active" = "active" ]; then
    echo "TIMER: $timer already enabled and active"
    return 0
  fi
  echo "TIMER: $timer enabled=$enabled active=$active — will enable --now (unit exists, simply not on)"
  if [ "$DRY" = "1" ]; then
    echo "DRY: systemctl enable --now $timer"
    return 0
  fi
  systemctl enable --now "$timer"
  echo "TIMER: $timer now enabled=$(systemctl is-enabled "$timer" 2>&1) active=$(systemctl is-active "$timer" 2>&1)"
}

echo "=== timer fix (enable only if the unit exists and is disabled/inactive) ==="
maybe_enable_timer disk-gc.timer
maybe_enable_timer pg-backup.timer
echo

# ── helpers for mutating tiers ──────────────────────────────────────────────
before_k=""
begin_tier() {
  before_k="$(used_k)"
  echo
  echo "=== $1  (disk $(pct)% , used_k=$before_k) ==="
}

end_tier() {
  local name="$1"
  local after_k after_pct delta_m
  after_k="$(used_k)"
  after_pct="$(pct)"
  delta_m=$(( (before_k - after_k) / 1024 ))
  echo "AFTER $name: ${after_pct}%  delta=${delta_m}M  (used_k $before_k -> $after_k)"
  df -h /
  note "$name ${delta_m}M -> ${after_pct}%"
  if [ "$DRY" != "1" ] && at_or_below_target; then
    echo "STOP: disk is ${after_pct}% (<= ${TARGET_PCT}%)"
    return 10
  fi
  return 0
}

# ── Tier 1 ──────────────────────────────────────────────────────────────────
begin_tier "tier 1 journal + apt"
if [ "$DRY" = "1" ]; then
  echo "DRY: journalctl --vacuum-size=200M && apt-get clean"
else
  journalctl --vacuum-size=200M >/dev/null 2>&1 || true
  apt-get clean >/dev/null 2>&1 || true
fi
end_tier "tier1" || { stop=1; }
if [ "${stop:-0}" = 1 ]; then
  :
else

# ── Tier 2 ──────────────────────────────────────────────────────────────────
begin_tier "tier 2 npm caches"
if [ "$DRY" = "1" ]; then
  echo "DRY: npm cache clean --force for ubuntu, openclaw, root (if those users exist)"
  for u in ubuntu openclaw root; do
    id "$u" >/dev/null 2>&1 && echo "  would clean as $u" || echo "  skip missing user $u"
  done
else
  for u in ubuntu openclaw root; do
    id "$u" >/dev/null 2>&1 || continue
    sudo -u "$u" npm cache clean --force >/dev/null 2>&1 || true
  done
fi
end_tier "tier2" || { stop=1; }
fi

if [ "${stop:-0}" != 1 ]; then
# ── Tier 3 ──────────────────────────────────────────────────────────────────
begin_tier "tier 3 releases beyond current+previous"
# Protect live and previous app pointers so a oddly-named extra dir cannot
# steal a KEEP slot from a real rollback target, and so we never delete
# the resolved current or previous path.
protected=""
for p in /opt/*/app /opt/*/app.prev /opt/*/app-old; do
  [ -e "$p" ] || continue
  protected="${protected}$(readlink -f "$p" 2>/dev/null)"$'\n'
done
for reldir in /opt/*/releases; do
  [ -d "$reldir" ] || continue
  # Also protect the two newest even if one is not the live symlink
  # (deploy.sh may have failed mid-swap).
  i=0
  ls -1t "$reldir" 2>/dev/null | while read -r name; do
    [ -n "$name" ] || continue
    i=$((i + 1))
    path="$reldir/$name"
    resolved="$(readlink -f "$path" 2>/dev/null || echo "$path")"
    if [ "$i" -le "$KEEP_RELEASES" ]; then
      echo "  KEEP  $path"
      continue
    fi
    case $'\n'"$protected"$'\n' in
      *$'\n'"$resolved"$'\n'*) echo "  KEEP (live or previous pointer) $path"; continue ;;
    esac
    if [ "$DRY" = "1" ]; then
      echo "  DRY rm -rf $path  ($(sz "$path"))"
    else
      echo "  rm -rf $path"
      rm -rf -- "$path"
    fi
  done
done
echo "  (Loki /opt/loki/app.prev and OrangeCat /opt/orangecat/app-old are never deleted)"
end_tier "tier3" || { stop=1; }
fi

if [ "${stop:-0}" != 1 ]; then
# ── Tier 4 ──────────────────────────────────────────────────────────────────
begin_tier "tier 4 docker images + build cache (no volumes, no running containers)"
if ! command -v docker >/dev/null 2>&1; then
  echo "  docker not installed — skip"
else
  if [ "$DRY" = "1" ]; then
    echo "DRY: docker image prune -af --filter until=${DOCKER_KEEP_HOURS}h"
    echo "DRY: docker builder prune -af --filter until=${DOCKER_KEEP_HOURS}h"
    docker images -f dangling=true --format '  dangling: {{.ID}} {{.Size}} {{.Repository}}:{{.Tag}}' 2>/dev/null || true
  else
    docker image prune -af --filter "until=${DOCKER_KEEP_HOURS}h" || true
    docker builder prune -af --filter "until=${DOCKER_KEEP_HOURS}h" || true
  fi
fi
end_tier "tier4" || { stop=1; }
fi

if [ "${stop:-0}" != 1 ]; then
# ── Tier 5 ──────────────────────────────────────────────────────────────────
begin_tier "tier 5 rotated logs older than 14 days"
if [ "$DRY" = "1" ]; then
  echo "DRY: would remove:"
  find /var/log -type f -name '*.gz' -mtime +14 -printf '  %p %kK\n' 2>/dev/null | head -100
  echo "  count=$(find /var/log -type f -name '*.gz' -mtime +14 2>/dev/null | wc -l | tr -d ' ')"
else
  find /var/log -type f -name '*.gz' -mtime +14 -delete 2>/dev/null || true
fi
end_tier "tier5" || { stop=1; }
fi

if [ "${stop:-0}" != 1 ]; then
# ── Tier 6 ──────────────────────────────────────────────────────────────────
begin_tier "tier 6 postgres dumps older than ${KEEP_BACKUP_DAYS} days"
if [ -d /opt/backups/pg ]; then
  recent="$(find /opt/backups/pg -maxdepth 1 -type f \( -name '*.dump' -o -name '*.sql.gz' \) -mtime -${KEEP_BACKUP_DAYS} | wc -l | tr -d ' ')"
  old="$(find /opt/backups/pg -maxdepth 1 -type f \( -name '*.dump' -o -name '*.sql.gz' \) -mtime +${KEEP_BACKUP_DAYS} | wc -l | tr -d ' ')"
  echo "  recent(<${KEEP_BACKUP_DAYS}d)=$recent  stale(>${KEEP_BACKUP_DAYS}d)=$old"
  if [ "$recent" = "0" ] && [ "$old" != "0" ]; then
    echo "  REFUSED: no dump from the last ${KEEP_BACKUP_DAYS} days is present; not deleting the stale ones"
  elif [ "$old" = "0" ]; then
    echo "  nothing older than ${KEEP_BACKUP_DAYS} days"
  elif [ "$DRY" = "1" ]; then
    echo "DRY: would delete $old stale dump(s); keeping $recent recent file(s)"
  else
    find /opt/backups/pg -maxdepth 1 -type f \( -name '*.dump' -o -name '*.sql.gz' \) -mtime +${KEEP_BACKUP_DAYS} -delete
    echo "  deleted $old stale dump(s); kept $recent recent file(s)"
  fi
else
  echo "  /opt/backups/pg missing — skip"
fi
end_tier "tier6" || { stop=1; }
fi

# ── Tier 7 only if still above 80% ──────────────────────────────────────────
if [ "${stop:-0}" != 1 ]; then
  cur="$(pct)"
  if [ "$cur" -gt "$TIER7_PCT" ]; then
    begin_tier "tier 7 idle dev node_modules (disk ${cur}% > ${TIER7_PCT}%)"
    if [ ! -d "$DEV_ROOT" ]; then
      echo "  $DEV_ROOT missing — skip"
    else
      now="$(date +%s)"
      # One pass of process cwds so we do not rm node_modules under a live build.
      proc_cwds="$(ls -l /proc/[0-9]*/cwd 2>/dev/null | sed 's/^.* -> //' || true)"
      for d in "$DEV_ROOT"/*/; do
        [ -d "$d" ] || continue
        d="${d%/}"
        nm="$d/node_modules"
        [ -d "$nm" ] || continue
        newest="$(find "$d" -maxdepth 3 -name node_modules -prune -o -type f -printf '%T@\n' 2>/dev/null | sort -rn | head -1 | cut -d. -f1)"
        newest="${newest:-0}"
        idle=$(( (now - newest) / 86400 ))
        if [ "$idle" -lt "$IDLE_DAYS" ]; then
          echo "  skip fresh (${idle}d): $d"
          continue
        fi
        if printf '%s\n' "$proc_cwds" | grep -F -q -- "$d"; then
          echo "  skip in use: $d"
          continue
        fi
        if [ "$DRY" = "1" ]; then
          echo "  DRY rm -rf $nm  ($(sz "$nm"), idle ${idle}d)"
        else
          echo "  rm -rf $nm (idle ${idle}d)"
          rm -rf -- "$nm"
        fi
      done
    fi
    end_tier "tier7" || true
  else
    echo
    echo "=== tier 7 skipped (disk ${cur}% is not above ${TIER7_PCT}%) ==="
  fi
fi

echo
echo "=== df -h (after) ==="
df -h
echo
echo "=== docker system df (after) ==="
if command -v docker >/dev/null 2>&1; then
  docker system df || true
else
  echo "docker not installed"
fi
echo
end_pct="$(pct)"
end_used="$(used_k)"
total_m=$(( (start_used - end_used) / 1024 ))
echo "=== summary dry_run=$DRY  start=${start_pct}%  end=${end_pct}%  freed=${total_m}M ==="
echo "per step: $FREED_SUMMARY"
echo "timers now: disk-gc=$(systemctl is-enabled disk-gc.timer 2>&1)/$(systemctl is-active disk-gc.timer 2>&1)  pg-backup=$(systemctl is-enabled pg-backup.timer 2>&1)/$(systemctl is-active pg-backup.timer 2>&1)"
