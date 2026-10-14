#!/usr/bin/env bash
# Disk garbage collection for the box — the fix for "we keep running out".
#
# Why this exists: the box went 40GB → 75GB and still filled up. It did not get
# fatter doing the same job — it took on new jobs. Measured 2026-08-06 at 55G used:
#
#     /home/ubuntu/dev  12G   ~13 dev checkouts, ~1GB node_modules each
#     /opt              12G   12 deployed apps (the apps themselves are small)
#     /var/lib/containerd 9.8G  Docker images — the live Supabase stack + strays
#     caches/toolchains ~9G   two users each with their own .nvm/.npm/.cache
#     /usr 5.6G  ·  /swapfile 4.1G  ·  the rest ~2G
#
# At 40GB the box hosted a couple of Next apps and none of the above existed.
# Cleaning by hand just resets the clock; this reclaims automatically.
#
# Design: a real garbage collector, not a cron that deletes things.
#   - Below HIGH_PCT it does NOTHING (no cost when there is room).
#   - Above it, it frees in increasing order of cost and STOPS the moment the
#     disk is back under TARGET_PCT. Cheap, regenerable things go first.
#       tier 1  journal + apt cache          (pure cache, zero cost)
#       tier 2  npm caches                   (re-downloaded on demand)
#       tier 3  release dirs beyond KEEP     (older rollback targets)
#       tier 4  container images NO container references (docker re-pulls)
#       tier 5  node_modules of IDLE repos   (restored by `npm ci`)
#   - Everything it removes is reconstructible. It never touches app data,
#     databases, any image a container actually uses (the live Supabase stack),
#     or a repo touched within IDLE_DAYS / with a process running inside it.
#
# NOT automated, deliberately: ~/.cache (3.4GB across the two users). It mixes
# free-to-refetch junk with things that only come back via an explicit command
# — ~/.cache/ms-playwright is the prod-dogfood browser set, and silently
# deleting it would break the smoke suite with no signal. Reclaim it by hand.
#
# Journals what it freed and pages only when the outcome is NOT routine
# (still above the warn mark, or nothing left to reclaim) — lib-alert.sh,
# and only when it actually did something — no "ran and did nothing" noise.
#
# Idempotent: re-run any time. Logic is covered by
# scripts/hetzner/test-disk-gc.sh (npm run test:ops).
#
# Usage: install-disk-gc.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ssh -o BatchMode=yes "$BOX" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
MON=/opt/monitoring
mkdir -p "$MON/state"

cat > "$MON/disk-gc.sh" <<'GC'
#!/usr/bin/env bash
set -uo pipefail
. "${MON:-/opt/monitoring}/lib-alert.sh"

# Single-instance guard. Two GC passes running at once race on the same
# directories (observed on install: the timer's catch-up run overlapped the
# initial one and both tried to remove the same node_modules). Harmless there
# because safe_rm is idempotent, but a GC that can run concurrently with itself
# will eventually delete something another pass is mid-way through reading.
#
# Hold the lock on a dedicated FD rather than `exec flock -n … "$0"`: exec
# REPLACES this shell, so the script's exit status becomes flock's — a busy lock
# then surfaced as exit 1 (a failed unit / red CI) even though "another pass is
# already running" is a perfectly normal outcome. The `||` after an exec can
# never run either. The lock releases automatically when the process exits.
# DISK_GC_NO_LOCK=1 lets the test suite drive the logic directly.
if [ "${DISK_GC_NO_LOCK:-0}" != "1" ] && command -v flock >/dev/null 2>&1; then
  exec 9>"${MON:-/opt/monitoring}/state/.disk-gc.lock" 2>/dev/null || true
  if ! flock -n 9 2>/dev/null; then
    logger -t disk-gc "another GC pass is already running — skipping"
    exit 0
  fi
fi

# Tunables (env-overridable so the test suite can drive them).
# HIGH_PCT sits BELOW the host-check disk alarm (85%) on purpose: the GC's job
# is to keep the disk off the alarm, so it must act before the alarm fires.
HIGH_PCT="${DISK_GC_HIGH_PCT:-80}"        # start reclaiming above this
TARGET_PCT="${DISK_GC_TARGET_PCT:-70}"    # stop once at or below this
IDLE_DAYS="${DISK_GC_IDLE_DAYS:-14}"      # a repo untouched this long is cold
KEEP_RELEASES="${DISK_GC_KEEP_RELEASES:-2}"
# An image pulled more recently than this is left alone — a fresh pull is
# probably a deploy mid-flight, not garbage.
DOCKER_KEEP_HOURS="${DISK_GC_DOCKER_KEEP_HOURS:-168}"
DEV_ROOT="${DISK_GC_DEV_ROOT:-/home/ubuntu/dev}"
OPT_ROOT="${DISK_GC_OPT_ROOT:-/opt}"
DRY_RUN="${DISK_GC_DRY_RUN:-0}"

pct()  { df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9'; }
usedk() { df --output=used  / 2>/dev/null | tail -1 | tr -dc '0-9'; }
done_yet() { [ "$(pct)" -le "$TARGET_PCT" ]; }

FREED_LOG=""
note() { FREED_LOG="${FREED_LOG}${FREED_LOG:+, }$1"; }

# Guarded recursive delete. Refuses anything that is not a real directory
# beneath the root it was told to work in — a GC that can rm -rf / is worse
# than a full disk.
safe_rm() { # <path> <required-prefix>
  local path="$1" prefix="$2"
  case "$path" in
    "$prefix"/*) ;;                      # must live under the prefix
    *) logger -t disk-gc "REFUSED (outside $prefix): $path"; return 1 ;;
  esac
  case "$path" in
    *..*) logger -t disk-gc "REFUSED (traversal): $path"; return 1 ;;
  esac
  [ -d "$path" ] || return 1
  if [ "$DRY_RUN" = "1" ]; then echo "DRY rm -rf $path"; return 0; fi
  rm -rf -- "$path"
}

# Is any running process working inside this directory? Stops the GC from
# pulling node_modules out from under a build or a live agent.
#
# The /proc scan is done ONCE and cached. It used to fork a readlink per PID on
# every call: with a few hundred processes and one call per candidate directory
# that is thousands of forks per run. Measured 2026-08-25 on a developer box, a
# single disk-gc invocation spent ~20s here, and the test that drives it three
# times was 100s — 22% of the whole `npm run verify` bundle. One `ls -l` pass
# is one fork total.
#
# Caching for the lifetime of the run is safe and is arguably the more correct
# reading anyway: the answer should be "was this in use when the GC started",
# not a value that can flip between two tiers of the same sweep.
_load_proc_cwds() {
  [ -n "${_PROC_CWDS_LOADED:-}" ] && return 0
  _PROC_CWDS=$(ls -l /proc/[0-9]*/cwd 2>/dev/null | sed 's/^.* -> //')
  _PROC_CWDS_LOADED=1
}

in_use() { # <dir>
  local dir="$1" link
  _load_proc_cwds
  while IFS= read -r link; do
    [ -n "$link" ] || continue
    case "$link" in "$dir"|"$dir"/*) return 0 ;; esac
  done <<PROC_CWDS
$_PROC_CWDS
PROC_CWDS
  return 1
}

start_pct=$(pct); start_used=$(usedk)
[ -n "${start_pct:-}" ] || exit 0
if [ "$start_pct" -le "$HIGH_PCT" ]; then
  logger -t disk-gc "disk ${start_pct}% <= ${HIGH_PCT}% — nothing to do"
  exit 0
fi
logger -t disk-gc "disk ${start_pct}% > ${HIGH_PCT}% — reclaiming down to ${TARGET_PCT}%"

# ── Tier 1: pure caches (free, regenerate themselves) ───────────────────────
if ! done_yet; then
  before=$(usedk)
  [ "$DRY_RUN" = "1" ] || { journalctl --vacuum-size=200M >/dev/null 2>&1; apt-get clean >/dev/null 2>&1; }
  after=$(usedk); d=$(( (before - after) / 1024 ))
  [ "$d" -gt 0 ] && note "journal/apt ${d}MB"
fi

# ── Tier 2: npm caches (re-downloaded on demand) ────────────────────────────
if ! done_yet; then
  before=$(usedk)
  for u in ubuntu openclaw root; do
    id "$u" >/dev/null 2>&1 || continue
    [ "$DRY_RUN" = "1" ] || sudo -u "$u" npm cache clean --force >/dev/null 2>&1
  done
  after=$(usedk); d=$(( (before - after) / 1024 ))
  [ "$d" -gt 0 ] && note "npm cache ${d}MB"
fi

# ── Tier 3: release dirs beyond KEEP_RELEASES (older rollback targets) ──────
if ! done_yet; then
  before=$(usedk); n=0
  for reldir in "$OPT_ROOT"/*/releases; do
    [ -d "$reldir" ] || continue
    # Newest first; anything past the keep-count is a stale rollback target.
    ls -1t "$reldir" 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
      [ -n "$old" ] || continue
      safe_rm "$reldir/$old" "$OPT_ROOT" && logger -t disk-gc "removed release $reldir/$old"
    done
    done_yet && break
  done
  after=$(usedk); d=$(( (before - after) / 1024 ))
  [ "$d" -gt 0 ] && note "old releases ${d}MB"
fi

# ── Tier 4: container images no container references (docker re-pulls) ──────
# /var/lib/containerd is the second-largest thing on the disk (9.8GB), and most
# of it is the live Supabase stack — which is why the tier is scoped by what
# Docker itself considers unreferenced. `prune -a` keeps every image belonging
# to a container that exists, running or stopped; it removes only the strays
# (measured: ~2.2GB of build base images no container ever used). Recovery is a
# re-pull Docker performs on its own, so nothing needs a human afterwards.
#
# GUARD — this tier is global by nature: docker has no --root to point at a
# sandbox, so unlike every other tier it cannot be aimed at a fake filesystem.
# Running the GC's own test suite on a developer machine therefore pruned the
# developer's images (2026-08-06, local Supabase dev stack; volumes survived,
# `npx supabase start` re-pulled). So it runs only when the roots are the BOX's
# roots — which means any test that redirects them disables this tier for free,
# without having to know it exists.
if ! done_yet && [ "$DEV_ROOT" = "/home/ubuntu/dev" ] && [ "$OPT_ROOT" = "/opt" ] \
   && command -v docker >/dev/null 2>&1; then
  before=$(usedk)
  [ "$DRY_RUN" = "1" ] || docker image prune -af --filter "until=${DOCKER_KEEP_HOURS}h" >/dev/null 2>&1 || true
  after=$(usedk); d=$(( (before - after) / 1024 ))
  [ "$d" -gt 0 ] && note "unused container images ${d}MB"
fi

# ── Tier 5: node_modules of cold dev checkouts (restored by `npm ci`) ───────
# Coldest first, so the repo you are most likely to touch next survives longest.
if ! done_yet && [ -d "$DEV_ROOT" ]; then
  before=$(usedk); now=$(date +%s)
  # Emit "<idle-seconds> <repo-dir>" for each checkout, coldest first. Activity
  # = newest source file EXCLUDING node_modules (an npm install would otherwise
  # make every repo look permanently fresh).
  while read -r _idle repo; do
    [ -n "$repo" ] || continue
    done_yet && break
    nm="$repo/node_modules"
    [ -d "$nm" ] || continue
    if in_use "$repo"; then logger -t disk-gc "skip (in use): $repo"; continue; fi
    safe_rm "$nm" "$DEV_ROOT" && logger -t disk-gc "removed $nm"
  done <<EOF
$(for d in "$DEV_ROOT"/*/; do
    [ -d "$d" ] || continue
    d="${d%/}"
    newest=$(find "$d" -maxdepth 3 -name node_modules -prune -o -type f -printf '%T@\n' 2>/dev/null \
             | sort -rn | head -1 | cut -d. -f1)
    newest="${newest:-0}"
    idle=$(( (now - newest) / 86400 ))
    [ "$idle" -ge "$IDLE_DAYS" ] && printf '%s %s\n' "$idle" "$d"
  done | sort -rn)
EOF
  after=$(usedk); d=$(( (before - after) / 1024 ))
  [ "$d" -gt 0 ] && note "cold node_modules ${d}MB"
fi

end_pct=$(pct); end_used=$(usedk)
total=$(( (start_used - end_used) / 1024 ))
if [ "$total" -gt 0 ]; then
  # Routine maintenance SUCCEEDING is not news. This fired at 00:02 on
  # 2026-08-29 — "freed 2296MB (81% → 78%)" — a correct report of the box
  # looking after itself, requiring nothing from anyone. The disk check already
  # pages above 85%, so a GC that lands back under the mark has, by definition,
  # removed the reason to say anything. It goes to the journal.
  #
  # It still PAGES when the outcome is not routine: space was reclaimed and the
  # disk is STILL above the warn mark, which is the trend that ends in a full
  # volume and is genuinely worth a human's attention.
  logger -t disk-gc "DISK GC: freed ${total}MB (${start_pct}% → ${end_pct}%) — ${FREED_LOG:-n/a}"
  if [ "${end_pct:-0}" -gt 85 ]; then
    alert "🧹" "DISK GC: freed ${total}MB but / is still ${end_pct}% — reclaiming is no longer keeping up. ${FREED_LOG:-n/a}"
  fi
else
  # Above the mark but nothing safe left to reclaim: that is a real capacity
  # problem and the operator needs to know it, not a silent no-op.
  logger -t disk-gc "nothing reclaimable; still ${end_pct}%"
  alert_transition diskgc bad "🚨" "DISK GC could not free space — still ${end_pct}% and every safe tier is exhausted. Needs a bigger volume or fewer checkouts."
fi
[ "$total" -gt 0 ] && alert_transition diskgc ok "" ""
exit 0
GC
chmod +x "$MON/disk-gc.sh"

cat > /etc/systemd/system/disk-gc.service <<'SVC'
[Unit]
Description=Reclaim disk on the box (caches, old releases, cold node_modules)
After=network-online.target
[Service]
Type=oneshot
ExecStart=/opt/monitoring/disk-gc.sh
SVC
cat > /etc/systemd/system/disk-gc.timer <<'TIMER'
[Unit]
Description=Run disk GC hourly (no-op unless the disk is actually under pressure)
[Timer]
OnBootSec=10min
OnUnitActiveSec=1h
Persistent=true
Unit=disk-gc.service
[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now disk-gc.timer >/dev/null 2>&1 || true
echo "[disk-gc] installed; timer active"
REMOTE
echo "[disk-gc] installed on $BOX"
