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

# The unit to drain: the owner's legacy loki-box-runner, or one private
# builder's instance (loki-box-runner@<tenant>). Its cgroup is wherever
# systemd put it — a template instance lives in a slice of its own.
UNIT="${1:-loki-box-runner}"
UNIT="${UNIT%.service}"
CGROUP="/sys/fs/cgroup$(systemctl show -p ControlGroup --value "${UNIT}.service" 2>/dev/null)/cgroup.procs"
# How long to keep waiting for working agents before giving up on THIS restart.
# Giving up never kills anyone: the runner keeps its current code and the next
# deploy (or the next time every agent is idle) lands it. Six hours because a
# real task runs for hours, and this box deploys several times a day.
MAX="${LOKI_RUNNER_DRAIN_SECS:-21600}"
# A Claude older than this with no status file is a leftover, not a task.
LEFTOVER="${LOKI_RUNNER_LEFTOVER_SECS:-86400}"
INTERVAL=20
# A sealed session that has relayed next to nothing for this long is not
# working (see agent_is_busy). Half an hour, on purpose far longer than any
# pause inside a task: an agent at work prints as it goes.
QUIET_SECS="${LOKI_RUNNER_QUIET_SECS:-1800}"
# "Next to nothing", per look. Open sessions at their prompt relayed 0, 40
# and 96 bytes in a whole minute when this was measured.
QUIET_BYTES="${LOKI_RUNNER_QUIET_BYTES:-512}"
# What each sealed session had relayed at the last look, and since when it
# has been quiet. Kept outside this process: every deploy starts a new drain,
# and a clock that restarted with it would never reach QUIET_SECS on a box
# that deploys several times an hour.
QUIET_STATE="${LOKI_RUNNER_QUIET_STATE:-/run/loki-drain/${UNIT}}"

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
#
# A Claude with NO status file is unknown, and unknown is busy — except when it
# has been running longer than LEFTOVER (a day). Every current Claude writes the
# file for as long as it runs; a process that has written none for a day is a
# session from a CLI that predates the file, or a helper left behind, and it
# was holding the drain open for ever. 2026-10-18: two such processes, 6 days
# and 1.8 days old, kept the runner on 12 October's code while every other
# agent sat idle — and since the commands route holds new work for a builder
# that is behind (src/lib/runner-update-hold.ts), no new task started at all.
#
# A sealed session has no status file this script can read: its agent lives
# inside gVisor and all the unit's cgroup holds is the `podman run` that
# relays its terminal. So it counted as working for as long as it was open,
# and sessions stay open for days. 2026-11-12: three open sealed sessions,
# one of them eighteen hours old, relayed 0, 40 and 96 bytes in a minute
# (Sealed builds run 43178274733, mode=activity) while this drain logged
# "3 agent(s) working" on every look and the runner stayed two releases
# behind; the commands route was holding new work for that restart the whole
# time. That relay is the one thing visible from here, and it carries every
# byte the agent prints and every key a person types: a session that has
# moved under QUIET_BYTES a look for QUIET_SECS is at its prompt, or stuck
# waiting on a person, and a restart reopens it. Less quiet than that, or
# quiet for a time that cannot be told, is still working: unknown is not idle.
agent_is_busy() { # <comm> <status or empty> [age in seconds] [quiet for, seconds]
  case "$1" in
    claude|hermes|codex|cursor-agent|grok|gemini|sealed-agent) ;;
    *) return 1 ;;
  esac
  [ "$1" = claude ] && { [ "$2" = idle ] || [ "$2" = dialog ]; } && return 1
  [ "$1" = claude ] && [ -z "$2" ] && [ "${3:-0}" -ge "$LEFTOVER" ] 2>/dev/null && return 1
  [ "$1" = sealed-agent ] && [ -n "${4:-}" ] && [ "$4" -ge "$QUIET_SECS" ] 2>/dev/null && return 1
  return 0
}

# relayed_bytes <pid> — everything the process has read and written, or empty.
relayed_bytes() {
  awk '/^rchar:/{r=$2} /^wchar:/{w=$2} END{ if (r != "" && w != "") print r + w }' \
    "${PROC_ROOT:-/proc}/$1/io" 2>/dev/null
}

# quiet_for <pid> <now, epoch seconds> — how long this process has relayed
# under QUIET_BYTES a look, in seconds; 0 the first time it is seen, when it
# moved, and when its counters cannot be read. The counters are cumulative,
# so a look after a long gap still answers for the whole gap.
quiet_for() {
  local pid="$1" now="$2" cur last since
  cur="$(relayed_bytes "$pid")"
  mkdir -p "$QUIET_STATE" 2>/dev/null || { echo 0; return 0; }
  if [ -z "$cur" ]; then rm -f "$QUIET_STATE/$pid.io" "$QUIET_STATE/$pid.since"; echo 0; return 0; fi
  last="$(cat "$QUIET_STATE/$pid.io" 2>/dev/null || true)"
  echo "$cur" > "$QUIET_STATE/$pid.io"
  case "$last" in ''|*[!0-9]*) last="" ;; esac
  if [ -z "$last" ] || [ "$cur" -lt "$last" ] || [ $((cur - last)) -ge "$QUIET_BYTES" ]; then
    echo "$now" > "$QUIET_STATE/$pid.since"
    echo 0
    return 0
  fi
  since="$(cat "$QUIET_STATE/$pid.since" 2>/dev/null || true)"
  case "$since" in ''|*[!0-9]*) since="$now"; echo "$now" > "$QUIET_STATE/$pid.since" ;; esac
  echo $((now - since))
}

# forget_ended — drop the notes of processes that are gone, so a recycled pid
# does not inherit another session's quiet.
forget_ended() {
  local f pid
  for f in "$QUIET_STATE"/*.io; do
    [ -e "$f" ] || continue
    pid="$(basename "$f" .io)"
    [ -d "${PROC_ROOT:-/proc}/$pid" ] || rm -f "$QUIET_STATE/$pid.io" "$QUIET_STATE/$pid.since"
  done
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

# sealed_container <pid> — is this `podman run` a sealed agent build (fc-ws-…)?
sealed_container() {
  { tr '\0' ' ' < "${PROC_ROOT:-/proc}/$1/cmdline"; } 2>/dev/null | grep -qE '(^| )run .*--name fc-ws-[0-9a-f]+'
}

# sealed_name <pid> — the fc-ws-… name of a sealed session's podman run.
sealed_name() {
  { tr '\0' ' ' < "${PROC_ROOT:-/proc}/$1/cmdline"; } 2>/dev/null | grep -oE -- '--name fc-ws-[0-9a-f]+' | head -1 | cut -d' ' -f2
}

# open_run_containers — the fc-ws-… names of every project (or lane) that has
# an open run in Loki's database, one per line; fails when it cannot be read.
# The same rule as sealed-builds-ctl.sh stop-idle: a session is named
# sha256("runner:" + tab)[0:24]. 2026-11-12: the relay of an idle sealed
# session moves 3 to 10 KB a minute, so the quiet rule never fired, every open
# session counted as working, and the runner kept the morning's code all day
# while the delivery-time fix waited in it.
open_run_containers() {
  local tabs
  tabs="$(sudo -u postgres psql -d "${LOKI_DB:-loki}" -qtAX -c "SELECT DISTINCT COALESCE(payload->>'sessionTab', project_key) FROM orchestration_runs WHERE finished_at IS NULL AND started_at > NOW() - INTERVAL '12 hours'" </dev/null 2>/dev/null)" || return 1
  printf '%s\n' "$tabs" | while read -r t; do
    [ -n "$t" ] && printf 'fc-ws-%s\n' "$(printf '%s' "runner:$t" | sha256sum | cut -c1-24)"
  done
  return 0
}

# between_runs <name> <open names> <age s> — a sealed session whose project has
# no open run, and that is older than FRESH_SECS (its run may not be recorded
# yet), is between tasks: a restart reopens it on the next message.
# Pure, pinned by test-drain-and-restart-runner.sh.
between_runs() {
  [ -n "$1" ] || return 1
  [ "${3:-0}" -ge "${FRESH_SECS:-900}" ] 2>/dev/null || return 1
  ! grep -qx -- "$1" <<<"$2"
}

if [ -n "${DRAIN_LIB_ONLY:-}" ]; then return 0; fi

count_agents() {
  [ -r "$CGROUP" ] || { echo 0; return 0; }
  local c=0 p comm quiet now open open_ok=""
  now="$(date +%s)"
  forget_ended
  open="$(open_run_containers)" && open_ok=1
  for p in $(cat "$CGROUP" 2>/dev/null); do
    quiet=""
    comm="$(cat "/proc/$p/comm" 2>/dev/null || true)"
    # A sealed build's agent lives inside gVisor: the unit's cgroup holds only
    # the `podman run --name fc-ws-…` that owns it, never a process named
    # gemini/claude. 2026-10-21 21:01 a restart killed a working Antigravity
    # run that way (runsc kill). Its podman is the agent.
    if [ "$comm" = podman ] && sealed_container "$p"; then
      comm=sealed-agent
      quiet="$(quiet_for "$p" "$now")"
      if [ -n "$open_ok" ] && between_runs "$(sealed_name "$p")" "$open" "$(ps -o etimes= -p "$p" 2>/dev/null | tr -d ' ')"; then
        continue
      fi
    fi
    agent_is_busy "$comm" "$(session_status "$p")" "$(ps -o etimes= -p "$p" 2>/dev/null | tr -d ' ')" "$quiet" && c=$((c + 1))
  done
  echo "$c"
}

waited=0
while :; do
  n="$(count_agents)"
  case "$(drain_decision "$n" "$waited" "$MAX")" in
    restart)
      log "no agent working after ${waited}s — restarting to pick up new code (open sessions reopen when it starts; Claude resumes each conversation)"
      systemctl restart "$UNIT" && sleep 4
      if systemctl is-active "$UNIT" >/dev/null 2>&1; then
        log "✓ ${UNIT} restarted (no agent was mid-task; idle sessions reopen on start)"
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
