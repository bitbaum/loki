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
# How long to keep waiting for working agents before giving up on THIS restart.
# Giving up never kills anyone: the runner keeps its current code and the next
# deploy (or the next time every agent is idle) lands it. Six hours because a
# real task runs for hours, and this box deploys several times a day.
MAX="${LOKI_RUNNER_DRAIN_SECS:-21600}"
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
#
# "dialog" (session_status's word for waiting + waitingFor "dialog open") is
# not work either: Claude is showing a dialog over an empty composer, holding
# nothing a restart could lose. 2026-09-26: Farmhouse sat on "Teach auto mode
# about your environment?" and held every runner update for the whole cap —
# including the one that teaches the runner to clear such dialogs.
agent_is_busy() { # <comm> <status or empty>
  case "$1" in
    claude|hermes|codex|cursor-agent|grok) ;;
    *) return 1 ;;
  esac
  [ "$1" = claude ] && { [ "$2" = idle ] || [ "$2" = dialog ]; } && return 1
  return 0
}

# session_status <pid> — Claude's own status for that process, or empty.
# PROC_ROOT exists only so the test can hand it a fake /proc.
session_status() {
  local home
  home="$({ tr '\0' '\n' < "${PROC_ROOT:-/proc}/$1/environ"; } 2>/dev/null | sed -n 's/^HOME=//p' | head -1)"
  [ -n "$home" ] && [ -r "$home/.claude/sessions/$1.json" ] || return 0
  local f="$home/.claude/sessions/$1.json" st
  st="$(sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([a-z_]*\)".*/\1/p' "$f" | head -1)"
  if [ "$st" = waiting ] && grep -q '"waitingFor"[[:space:]]*:[[:space:]]*"[^"]*dialog' "$f"; then
    echo dialog
  else
    echo "$st"
  fi
}

# drain_decision <working agents> <waited s> <max s> — restart | wait | leave.
# Pure, pinned by test-drain-and-restart-runner.sh.
#
# There is no "restart anyway". The cap used to force the restart, and on
# 2026-09-25 it did: a Skif agent 30 minutes into a multi-hour brief was killed
# at 09:01 because a Loki deploy had changed runner code. Stale runner code is
# recoverable (the next drain lands it); an agent's half-done work is not.
drain_decision() {
  if [ "${1:-0}" -eq 0 ] 2>/dev/null; then echo restart; return; fi
  if [ "$2" -lt "$3" ]; then echo wait; return; fi
  echo leave
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
while :; do
  n="$(count_agents)"
  case "$(drain_decision "$n" "$waited" "$MAX")" in
    restart)
      log "no agent working after ${waited}s — restarting to pick up new code (idle sessions resume on their next dispatch)"
      systemctl restart "$UNIT" && sleep 4
      if systemctl is-active "$UNIT" >/dev/null 2>&1; then
        log "✓ ${UNIT} restarted (drained cleanly, no agent killed)"
        exit 0
      fi
      log "✗ ${UNIT} did not come back after restart"
      exit 1
      ;;
    wait)
      log "${n} agent(s) working — deferring restart (${waited}s/${MAX}s)"
      sleep "$INTERVAL"
      waited=$((waited + INTERVAL))
      ;;
    leave)
      # Loud on purpose: the runner is now behind the code that was deployed.
      log "⚠ ${n} agent(s) still working after ${MAX}s — NOT restarting; ${UNIT} keeps its current code until the next deploy or the next idle moment"
      exit 0
      ;;
  esac
done
