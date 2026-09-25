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

busy() { agent_is_busy "$1" "$2" && echo busy || echo free; }

[ "$(busy claude idle)" = free ] \
  && ok "an idle Claude at its prompt does not hold the restart" \
  || no "an idle Claude holds the drain open — every deploy waits the full cap and then kills the newest work"

for st in busy running generating waiting; do
  [ "$(busy claude "$st")" = busy ] \
    && ok "a Claude that is '$st' holds the restart" \
    || no "a Claude that is '$st' would be killed mid-task"
done

[ "$(busy claude "")" = busy ] \
  && ok "a Claude with no readable status is treated as working" \
  || no "a Claude with no status file is assumed idle — unknown must not mean idle"

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
grep -q 'agent_is_busy "$comm" "$(session_status "$p")" && c=$((c + 1))' "$SCRIPT" \
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
got="$(PROC_ROOT="$tmp/proc" session_status 9999)"
[ -z "$got" ] && [ "$(busy claude "$got")" = busy ] \
  && ok "a pid with no environ or session file reads as unknown, so busy" \
  || no "a missing session file produced '$got'"
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
