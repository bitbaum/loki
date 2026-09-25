#!/usr/bin/env bash
# Box-side: wait for in-flight agents to finish, THEN restart the box-runner.
#
# Runs ON the box as a detached transient systemd unit, not inside the deploy.
# The deploy used to do this waiting itself, in the CI job, and it was the
# single most expensive thing in the pipeline: 480 of the ship step's 570
# seconds were this loop, which then timed out and restarted anyway. That is
# the worst of both worlds — the cost of patience with the semantics of
# impatience, paid in CI wall-clock on every runner-code change.
#
# Waiting is free HERE and expensive THERE. Moving the wait to the box lets it
# be both longer (agents genuinely finish instead of being killed at 8 minutes)
# and free (the deploy returns as soon as the app is verified live).
#
# Deliberately NOT in the runner's own cgroup: systemd-run gives this its own
# unit, so restarting loki-box-runner cannot kill the thing doing the
# restarting.

set -uo pipefail

UNIT="loki-box-runner"
CGROUP="/sys/fs/cgroup/system.slice/${UNIT}.service/cgroup.procs"
# Generous because it costs nothing now. Still bounded: a runner-code fix must
# eventually land even if some agent never exits.
MAX="${LOKI_RUNNER_DRAIN_SECS:-1800}"
INTERVAL=20

log() { logger -t loki-drain "$*" 2>/dev/null || true; echo "[drain] $*"; }

# agent_is_busy <comm> <status> — does this agent process hold work a restart
# would destroy? Pure, so test-drain-and-restart-runner.sh can pin it.
#
# It used to be "is an agent process alive", and interactive CLIs never exit:
# they sit at their prompt for days. So every runner deploy waited the full cap
# for sessions that were doing nothing, then force-restarted and killed
# whatever had started most recently. 2026-09-25: the drain ran 30 minutes for
# four idle Claude tabs and killed a Skif agent two minutes into its task.
#
# Claude says what it is doing in ~/.claude/sessions/<pid>.json. "idle" means it
# is at an empty composer, safe to restart. Anything else, generating or
# "waiting" on a permission prompt mid-task, is work. An agent that keeps no
# status file, or whose file cannot be read, is busy: unknown is not idle.
agent_is_busy() { # <comm> <status or empty>
  case "$1" in
    claude|hermes|codex|cursor-agent|grok) ;;
    *) return 1 ;;
  esac
  [ "$1" = claude ] && [ "$2" = idle ] && return 1
  return 0
}

# session_status <pid> — Claude's own status for that process, or empty.
# PROC_ROOT exists only so the test can hand it a fake /proc.
session_status() {
  local home
  home="$({ tr '\0' '\n' < "${PROC_ROOT:-/proc}/$1/environ"; } 2>/dev/null | sed -n 's/^HOME=//p' | head -1)"
  [ -n "$home" ] && [ -r "$home/.claude/sessions/$1.json" ] || return 0
  sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([a-z_]*\)".*/\1/p' "$home/.claude/sessions/$1.json" | head -1
}

if [ -n "${DRAIN_LIB_ONLY:-}" ]; then return 0; fi

count_agents() {
  [ -r "$CGROUP" ] || { echo 0; return 0; }
  local c=0 p comm
  for p in $(cat "$CGROUP" 2>/dev/null); do
    comm="$(cat "/proc/$p/comm" 2>/dev/null || true)"
    agent_is_busy "$comm" "$(session_status "$p")" && c=$((c + 1))
  done
  echo "$c"
}

waited=0
while [ "$waited" -lt "$MAX" ]; do
  n="$(count_agents)"
  if [ "${n:-0}" -eq 0 ] 2>/dev/null; then
    log "no agent working after ${waited}s — restarting to pick up new code (idle sessions resume on their next dispatch)"
    systemctl restart "$UNIT" && sleep 4
    if systemctl is-active "$UNIT" >/dev/null 2>&1; then
      log "✓ ${UNIT} restarted (drained cleanly, no agent killed)"
      exit 0
    fi
    log "✗ ${UNIT} did not come back after restart"
    exit 1
  fi
  log "${n} agent(s) working — deferring restart (${waited}s/${MAX}s)"
  sleep "$INTERVAL"
  waited=$((waited + INTERVAL))
done

# Cap reached. Restart anyway: stale runner code is its own outage. Idle
# sessions no longer hold the drain open, so reaching the cap now means an agent
# really has been generating (or stuck mid-task) for 30 minutes.
log "⚠ drain cap ${MAX}s reached — restarting anyway so the runner code lands"
systemctl restart "$UNIT" && sleep 4
systemctl is-active "$UNIT" >/dev/null 2>&1 \
  && { log "✓ ${UNIT} restarted (forced after cap)"; exit 0; }
log "✗ ${UNIT} did not come back after forced restart"
exit 1
