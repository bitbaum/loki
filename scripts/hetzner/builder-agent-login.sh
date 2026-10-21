#!/usr/bin/env bash
# Box-side (root): run a coding agent's own CLI device login for the runner user,
# the same way you would in a terminal — no API key. Prints the sign-in URL /
# device code to the log, waits up to WAIT seconds, then prints status.
# Credentials land in the runner user's HOME (~/.cursor, ~/.config/cursor,
# ~/.grok), which the sealed container bind-mounts (sealed-builds-ctl.sh mounts
# $HOME), and are then copied to per-tenant builder homes (lk-*) if any.
# Usage: builder-agent-login.sh cursor|grok [wait_seconds]
set -uo pipefail
AGENT="${1:-cursor}"; WAIT="${2:-900}"
RUNNER_USER="${RUNNER_USER:-ubuntu}"; H="/home/$RUNNER_USER"; BIN="$H/.local/bin"
as_user() { sudo -u "$RUNNER_USER" -H env PATH="$BIN:/usr/local/bin:/usr/bin:/bin" \
  NO_OPEN_BROWSER=1 BROWSER=echo TERM=xterm-256color bash -lc "$1"; }
case "$AGENT" in
  cursor) LOGIN="cursor-agent login"; STATUS="cursor-agent status"; DIRS=".cursor .config/cursor" ;;
  grok)
    echo "→ grok --help (login options):"; as_user "grok --help 2>&1 | grep -iE 'login|auth|device' | head -10"
    if as_user "grok login --help >/dev/null 2>&1"; then LOGIN="grok login"; else LOGIN="grok auth login"; fi
    STATUS="grok whoami 2>&1 || grok auth status 2>&1 || grok status 2>&1"; DIRS=".grok .config/grok" ;;
  *) echo "::error::agent must be cursor or grok"; exit 2 ;;
esac
echo "→ before: $(as_user "$STATUS" 2>&1 | head -3)"
LOG=$(mktemp); chown "$RUNNER_USER" "$LOG"
echo "→ running: $LOGIN (pty)"
as_user "script -qfc '$LOGIN' '$LOG' </dev/null >/dev/null 2>&1" &
PID=$!
# Stream the login output (ANSI stripped) so the URL/code shows promptly.
( tail -n +1 -f "$LOG" --pid=$PID 2>/dev/null | sed -u 's/\x1b\[[0-9;?]*[a-zA-Z]//g; s/\r/\n/g' | grep --line-buffered -v '^[[:space:]]*$' ) &
T=0; while kill -0 $PID 2>/dev/null && [ $T -lt "$WAIT" ]; do sleep 5; T=$((T+5)); done
kill $PID 2>/dev/null; sleep 1
echo; echo "→ after ${T}s: $(as_user "$STATUS" 2>&1 | head -5)"
for u in $(getent passwd | cut -d: -f1 | grep '^lk-'); do
  uh=$(getent passwd "$u" | cut -d: -f6)
  for d in $DIRS; do [ -e "$H/$d" ] || continue; mkdir -p "$uh/$(dirname "$d")"; rm -rf "$uh/$d"; cp -a "$H/$d" "$uh/$d"; chown -R "$u:" "$uh/$d"; done
  echo "  copied creds to $u"
done
rm -f "$LOG"
