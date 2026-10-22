#!/usr/bin/env bash
#
# Tests for which agent processes hold a box-runner restart back.
#
# The drain used to wait for agent processes to EXIT, and interactive CLIs
# never exit: they sit at their prompt until something kills them. So every
# runner deploy waited the full 30-minute cap for idle sessions, then forced
# the restart and killed whatever had started most recently. 2026-09-25: four
# idle Claude tabs held the drain open and a Skif agent two minutes into its
# task was the one killed.
#
# Pinned here: an idle Claude does not hold the restart; a generating or
# mid-task one does; anything whose state we cannot read does too, because
# unknown is not idle.
#
# Pure: no box, no systemd, no /proc.

set -uo pipefail
SCRIPT="$(dirname "$0")/drain-and-restart-runner.sh"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
no() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }

# shellcheck source=drain-and-restart-runner.sh
DRAIN_LIB_ONLY=1 . "$SCRIPT"

busy() { agent_is_busy "$1" "$2" "${3:-}" && echo busy || echo free; }

[ "$(busy claude idle)" = free ] \
  && ok "an idle Claude at its prompt does not hold the restart" \
  || no "an idle Claude holds the drain open — every deploy waits the full cap and then kills the newest work"

for st in busy running generating waiting; do
  [ "$(busy claude "$st")" = busy ] \
    && ok "a Claude that is '$st' holds the restart" \
    || no "a Claude that is '$st' would be killed mid-task"
done

[ "$(busy claude dialog)" = free ] \
  && ok "a Claude showing a dialog over an empty composer does not hold the restart" \
  || no "a dialog holds every runner update for the whole cap (Farmhouse, 2026-09-26)"

[ "$(busy claude "")" = busy ] \
  && ok "a Claude with no readable status is treated as working" \
  || no "a Claude with no status file is assumed idle — unknown must not mean idle"

[ "$(busy claude "" 3600)" = busy ] \
  && ok "a Claude an hour old with no status file still holds the restart" \
  || no "a young Claude with no status file was assumed idle"

[ "$(busy claude "" 518400)" = free ] \
  && ok "a Claude six days old with no status file is a leftover and does not hold the restart" \
  || no "a leftover Claude with no status file holds every runner update for ever (2026-10-18)"

[ "$(busy claude generating 518400)" = busy ] \
  && ok "an old Claude that says it is working still holds the restart" \
  || no "age overrode a status that says the agent is working"

[ "$(busy codex "" 518400)" = busy ] \
  && ok "age frees only Claude, the one agent that writes a status file" \
  || no "an old codex was assumed idle"

for comm in codex grok cursor-agent hermes; do
  [ "$(busy "$comm" idle)" = busy ] \
    && ok "$comm keeps no Claude status file, so it holds the restart" \
    || no "$comm was trusted with a status it does not write"
done

for comm in bash node tsx sleep; do
  [ "$(busy "$comm" "")" = free ] \
    && ok "'$comm' is not an agent and never holds the restart" \
    || no "'$comm' counted as an agent — the runner's own processes would block every drain"
done

# The drain must count with agent_is_busy, not with "is it alive".
grep -q 'agent_is_busy "$comm" "$(session_status "$p")" "$(ps -o etimes= -p "$p"' "$SCRIPT" \
  && ok "count_agents counts working agents, not live processes" \
  || no "count_agents no longer asks agent_is_busy"

# session_status reads Claude's own file for that pid, under THAT process's
# HOME (the runner may run as ubuntu or fcrunner), through a fake /proc.
tmp="$(mktemp -d)"
mkdir -p "$tmp/proc/4242" "$tmp/proc/5151" "$tmp/home/.claude/sessions"
printf 'PATH=/usr/bin\0HOME=%s\0TERM=xterm\0' "$tmp/home" > "$tmp/proc/4242/environ"
printf 'HOME=%s\0' "$tmp/home" > "$tmp/proc/5151/environ"
printf '{"pid":4242,"cwd":"/home/ubuntu/dev/skif","status":"busy","statusUpdatedAt":1}' \
  > "$tmp/home/.claude/sessions/4242.json"
printf '{"pid":5151,"cwd":"/home/ubuntu/dev/solon","status":"idle","statusUpdatedAt":1}' \
  > "$tmp/home/.claude/sessions/5151.json"
got="$(PROC_ROOT="$tmp/proc" session_status 4242)"
[ "$got" = busy ] \
  && ok "a generating session's status is read from its own file" \
  || no "session_status returned '$got' for a busy session"
got="$(PROC_ROOT="$tmp/proc" session_status 5151)"
[ "$got" = idle ] \
  && ok "an idle session reads as idle" \
  || no "session_status returned '$got' for an idle session"
mkdir -p "$tmp/proc/6161" "$tmp/proc/7171"
printf 'HOME=%s\0' "$tmp/home" > "$tmp/proc/6161/environ"
printf 'HOME=%s\0' "$tmp/home" > "$tmp/proc/7171/environ"
printf '{"pid":6161,"status":"waiting","updatedAt":1,"waitingFor":"dialog open"}' \
  > "$tmp/home/.claude/sessions/6161.json"
printf '{"pid":7171,"status":"waiting","updatedAt":1,"waitingFor":"permission"}' \
  > "$tmp/home/.claude/sessions/7171.json"
got="$(PROC_ROOT="$tmp/proc" session_status 6161)"
[ "$got" = dialog ] \
  && ok "a session waiting on a dialog reads as 'dialog'" \
  || no "session_status returned '$got' for a dialog"
got="$(PROC_ROOT="$tmp/proc" session_status 7171)"
[ "$got" = waiting ] && [ "$(busy claude "$got")" = busy ] \
  && ok "a session waiting on a permission prompt is still work" \
  || no "a permission prompt mid-task read as '$got'"
got="$(PROC_ROOT="$tmp/proc" session_status 9999)"
[ -z "$got" ] && [ "$(busy claude "$got")" = busy ] \
  && ok "a pid with no environ or session file reads as unknown, so busy" \
  || no "a missing session file produced '$got'"
rm -rf "$tmp"

# A sealed (gVisor) agent is visible only as its `podman run --name fc-ws-…`.
tmp="$(mktemp -d)"; mkdir -p "$tmp/proc/8181" "$tmp/proc/8282"
printf 'podman\0run\0--rm\0-i\0-t\0--name\0fc-ws-0123456789abcdef01234567\0loki-agent:latest\0gemini\0' > "$tmp/proc/8181/cmdline"
printf 'podman\0images\0' > "$tmp/proc/8282/cmdline"
PROC_ROOT="$tmp/proc" sealed_container 8181 && [ "$(busy sealed-agent "")" = busy ] \
  && ok "a sealed agent's podman run holds the restart" \
  || no "a sealed agent did not hold the restart (21:01 runsc kill)"
PROC_ROOT="$tmp/proc" sealed_container 8282 \
  && no "any podman counted as an agent" || ok "other podman commands do not hold it"
[ "$(busy gemini "")" = busy ] && ok "an unsealed gemini holds the restart" || no "gemini ignored"
rm -rf "$tmp"

# ── The cap never kills. 2026-09-25 09:01: a Skif agent 30 minutes into a
# multi-hour brief was force-restarted away because a deploy changed runner
# code. Waiting longer is free; killing work is not recoverable.
[ "$(drain_decision 0 0 21600)" = restart ] \
  && ok "nothing working → restart now" \
  || no "an idle runner is not restarted"
[ "$(drain_decision 0 99999 21600)" = restart ] \
  && ok "nothing working past the cap → still restart" \
  || no "an idle runner past the cap is not restarted"
[ "$(drain_decision 1 600 21600)" = wait ] \
  && ok "an agent working inside the cap → wait" \
  || no "a working agent inside the cap is not waited for"
[ "$(drain_decision 2 21600 21600)" = leave ] \
  && ok "agents still working at the cap → leave the runner alone, never kill" \
  || no "the cap restarts over working agents — the 09:01 kill"
grep -q 'forced after cap\|restarting anyway' "$SCRIPT" \
  && no "a forced restart path still exists in the drain" \
  || ok "the drain has no forced-restart path left"
[ "$(sed -n 's/^MAX="\${LOKI_RUNNER_DRAIN_SECS:-\([0-9]*\)}"$/\1/p' "$SCRIPT")" -ge 14400 ] 2>/dev/null \
  && ok "the default wait covers a multi-hour task (≥ 4h)" \
  || no "the default drain wait is shorter than a real task"

printf 'drain-and-restart-runner: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
