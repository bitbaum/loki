#!/usr/bin/env bash
# What uses this box's memory and disk. READ-ONLY: it measures and prints.
# Piped to `bash -s` as root from .github/workflows/box-usage.yml (same SSH
# setup as box-doctor.yml and disk-cleanup.yml).
#
# Why it exists: on 2026-11-11 the box sat at 91-95% memory and 91-93% disk,
# both sites reset connections, CI could not sign in against production auth,
# and nothing could say WHAT was using either. disk-cleanup.sh reclaims disk;
# nothing measured memory at all.
#
# THE REPO IS PUBLIC and run logs are too. This prints sizes, counts and
# program NAMES only: `comm`, never a command line, because arguments and
# environments carry tokens. No file contents, no env, no keys.
set -uo pipefail

section() { printf '\n=== %s ===\n' "$1"; }

# On 2026-11-12 the box had 0.6 GiB available and no swap left, and this report
# was cancelled at its 20-minute limit inside the first `du`: the memory facts
# were printed, nothing after them. A disk walk on a box that is swapping can
# take longer than anyone waits, so each one gets a minute and the report goes on.
du() { timeout 60 du "$@"; }
find() { timeout 60 find "$@"; }

section "memory"
free -h
echo
awk '/MemTotal|MemAvailable|SwapTotal|SwapFree/ {printf "%s %.1f GiB\n", $1, $2/1048576}' /proc/meminfo

section "memory by program (resident, summed over its processes)"
ps -eo rss=,comm= | awk '{rss[$2]+=$1; n[$2]++} END {for (p in rss) printf "%8.0f MiB  %4d proc  %s\n", rss[p]/1024, n[p], p}' | sort -rn | head -25

section "memory by service: who holds it, and what bounds the builder"
# Sealed agent sessions are meant to be bounded by the runner unit's memory
# ceiling (src/lib/agent-execution/sandbox.ts says "MemoryMax still bounds
# them"). This prints whether the unit has one, what it holds now, and which
# cgroup the sandboxes' own processes are in. Names and sizes only.
for unit in loki-box-runner.service; do
  systemctl show "$unit" -p MemoryCurrent -p MemorySwapCurrent -p MemoryHigh -p MemoryMax -p OOMPolicy -p OOMScoreAdjust 2>/dev/null \
    | awk -F= -v u="$unit" 'BEGIN {printf "%s:", u}
        $1 ~ /Current$/ && $2 ~ /^[0-9]+$/ {printf " %s=%.1fGiB", $1, $2/1073741824; next}
        {printf " %s=%s", $1, $2}
        END {print ""}'
done
echo
echo "sandbox processes by cgroup:"
ps -eo cgroup=,comm= 2>/dev/null | awk '$2 == "gvisor_sentry" {c[$1]++} END {for (k in c) printf "%6d  %s\n", c[k], k}' | sort -rn | head -6
echo
timeout 20 systemd-cgtop -b -n 1 --order=memory --depth=3 2>/dev/null | head -16

section "agent CLIs and browsers: how many, how old"
for name in claude gemini grok cursor-agent codex chrome chromium node; do
  count="$(pgrep -c -x "$name" 2>/dev/null)"
  [ "${count:-0}" = "0" ] && continue
  oldest="$(ps -o etimes= -C "$name" 2>/dev/null | sort -rn | head -1 | tr -d ' ')"
  mib="$(ps -o rss= -C "$name" 2>/dev/null | awk '{s+=$1} END {printf "%.0f", s/1024}')"
  printf '%-14s %4s processes  %6s MiB  oldest %s h\n' "$name" "$count" "${mib:-0}" "$(( ${oldest:-0} / 3600 ))"
done

section "out-of-memory kills since boot"
journalctl -k -b --no-pager 2>/dev/null | grep -ci 'out of memory' || true
journalctl -k -b --no-pager 2>/dev/null | grep -i 'out of memory' | sed -E 's/.*Killed process [0-9]+ \(([^)]*)\).*/\1/' | sort | uniq -c | sort -rn | head -10

section "containers: memory now"
if command -v docker >/dev/null 2>&1; then
  docker stats --no-stream --format '{{.MemUsage}}\t{{.Name}}' 2>/dev/null | sort -rh | head -25
fi

# `memory` as the first argument stops here: the disk walks below took the
# whole 20 minutes on 2026-11-12, twice, when only the memory was wanted.
if [ "${1:-all}" = "memory" ]; then exit 0; fi

section "disk"
df -h / 2>/dev/null
echo
du -xsh /opt /home /var/lib/docker /var/log /root /tmp 2>/dev/null | sort -rh

section "disk: /home/ubuntu, largest"
du -xh --max-depth=1 /home/ubuntu 2>/dev/null | sort -rh | head -15

section "disk: agent workspaces"
for dir in /home/ubuntu/.loki/workspaces /home/ubuntu/dev; do
  [ -d "$dir" ] || continue
  total="$(du -xsh "$dir" 2>/dev/null | cut -f1)"
  count="$(find "$dir" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
  modules="$(find "$dir" -maxdepth 3 -type d -name node_modules -prune 2>/dev/null | wc -l)"
  stale="$(find "$dir" -mindepth 1 -maxdepth 1 -type d -mtime +14 2>/dev/null | wc -l)"
  printf '%s: %s in %s directories; %s with node_modules; %s untouched for 14 days\n' "$dir" "${total:-?}" "$count" "$modules" "$stale"
done

section "disk: /opt, largest"
du -xh --max-depth=1 /opt 2>/dev/null | sort -rh | head -20

section "disk: docker"
if command -v docker >/dev/null 2>&1; then
  docker system df 2>/dev/null
  echo
  docker volume ls -q 2>/dev/null | while read -r v; do
    path="$(docker volume inspect -f '{{.Mountpoint}}' "$v" 2>/dev/null)"
    [ -n "$path" ] && printf '%s\t%s\n' "$(du -xsh "$path" 2>/dev/null | cut -f1)" "$v"
  done | sort -rh | head -12
fi

section "disk: uploaded files (Supabase Storage)"
find / -xdev -type d -path '*volumes/storage*' -maxdepth 6 2>/dev/null | head -3 | while read -r d; do
  printf '%s\t%s\n' "$(du -xsh "$d" 2>/dev/null | cut -f1)" "$d"
done

# One level further into the directories the first report showed were large
# but did not explain (2026-11-11: /opt/solon 18G with two releases, 22G of
# caches under /home/ubuntu, 16G of checkouts). Each listing gets a time
# budget: on a disk full of node_modules an unbounded du runs for minutes.
drill() {
  local dir="$1" depth="${2:-1}" rows="${3:-12}"
  [ -d "$dir" ] || return 0
  section "disk: inside $dir"
  timeout 90 du -xh --max-depth="$depth" "$dir" 2>/dev/null | sort -rh | head -"$rows" \
    || echo "(over 90s, skipped)"
}
drill /opt/solon 2 16
drill /opt/loki 2 16
drill /opt/kivvi 2 8
drill /opt/backups 2 8
drill /home/ubuntu/.local 3 14
drill /home/ubuntu/.cache 2 14
drill /home/ubuntu/.loki 2 14
drill /home/ubuntu/dev 1 46
drill /var/lib/containerd 2 8
drill /usr 1 8

# Databases. The first report never looked here, and a table of image bytes
# (Solon keeps place photographs in Postgres) is invisible to a du of /opt.
section "disk: databases"
du -xsh /var/lib/postgresql 2>/dev/null
as_postgres() {
  if command -v sudo >/dev/null 2>&1; then sudo -u postgres "$@"; else runuser -u postgres -- "$@"; fi
}
if command -v psql >/dev/null 2>&1; then
  as_postgres psql -At -F $'\t' -c \
    "SELECT pg_size_pretty(pg_database_size(datname)), datname FROM pg_database WHERE NOT datistemplate ORDER BY pg_database_size(datname) DESC LIMIT 15" 2>/dev/null
  # The five largest tables of the three largest databases: names and sizes only.
  for db in $(as_postgres psql -At -c \
    "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY pg_database_size(datname) DESC LIMIT 3" 2>/dev/null); do
    echo "-- largest tables in $db"
    as_postgres psql -d "$db" -At -F $'\t' -c \
      "SELECT pg_size_pretty(pg_total_relation_size(c.oid)), n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 5" 2>/dev/null
  done
fi
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx supabase-db; then
  echo "-- supabase-db"
  docker exec supabase-db psql -U postgres -At -F $'\t' -c \
    "SELECT pg_size_pretty(pg_database_size(datname)), datname FROM pg_database WHERE NOT datistemplate ORDER BY pg_database_size(datname) DESC LIMIT 5" 2>/dev/null
fi

section "disk: database dumps, by database (last 14 days)"
if [ -d /opt/backups/pg ]; then
  find /opt/backups/pg -maxdepth 1 -type f -printf '%s %f\n' 2>/dev/null \
    | sed -E 's/-[0-9]{8}-[0-9]{6}\.(dump|sql\.gz)$//' \
    | awk '{size[$2]+=$1; n[$2]++} END {for (d in size) printf "%8.0f MiB  %3d files  %s\n", size[d]/1048576, n[d], d}' \
    | sort -rn | head -12
fi

section "disk: build output and dependencies inside checkouts"
for kind in node_modules .next .turbo; do
  count="$(timeout 60 find /home/ubuntu/dev /home/ubuntu/.loki -maxdepth 6 -type d -name "$kind" -prune 2>/dev/null | wc -l)"
  printf '%s directories named %s\n' "$count" "$kind"
done

section "disk: other large files"
ls -lh /swapfile 2>/dev/null | awk '{print $5, $9}'
timeout 60 find / -xdev -type f -size +500M 2>/dev/null | head -15 | while read -r f; do
  printf '%s\t%s\n' "$(du -h "$f" 2>/dev/null | cut -f1)" "$f"
done

echo
echo "box-usage: done, nothing changed"
