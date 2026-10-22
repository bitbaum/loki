#!/usr/bin/env bash
# Box-side (root): run a coding agent's own CLI device login for the runner user
# (no API key). mode=login starts the login DETACHED (setsid nohup script) so it
# keeps waiting up to 15 min for approval on the box, while this job prints the
# sign-in URL/code and exits within ~30s (so `gh run view --log` can read it).
# mode=status prints the agent status and the tail of the login log.
# Creds land in the runner HOME (~/.cursor, ~/.config/cursor, ~/.grok), which
# the sealed container bind-mounts; mode=status also copies them to lk-* homes.
# Usage: builder-agent-login.sh cursor|grok [login|status]
set -uo pipefail
AGENT="${1:-cursor}"; MODE="${2:-login}"
RUNNER_USER="${RUNNER_USER:-ubuntu}"; H="/home/$RUNNER_USER"; BIN="$H/.local/bin"
LOG="$H/.loki-login-$AGENT.log"
as_user() { sudo -u "$RUNNER_USER" -H env PATH="$BIN:/usr/local/bin:/usr/bin:/bin" \
  NO_OPEN_BROWSER=1 BROWSER=echo TERM=xterm-256color bash -lc "$1"; }
clean() { sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g; s/\x1b\][^\a]*\a//g; s/\r/\n/g' "$LOG" 2>/dev/null | grep -v '^[[:space:]]*$'; }
case "$AGENT" in
  cursor) LOGIN="cursor-agent login"; STATUS="cursor-agent status"; DIRS=".cursor .config/cursor" ;;
  grok)
    echo "→ grok --help (login lines):"; as_user "grok --help 2>&1 | grep -iE 'login|auth|device' | head -10"
    if as_user "grok login --help >/dev/null 2>&1"; then LOGIN="grok login"; else LOGIN="grok auth login"; fi
    # grok has no `status`, and `whoami` needs a tty: run it under script.
    STATUS="{ [ -s ~/.grok/auth.json ] && echo 'auth file: ~/.grok/auth.json present' || echo 'auth file: none (not logged in)'; } ; script -qfc 'timeout 20 grok whoami' /dev/null </dev/null 2>&1 | sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' | tr -d '\r' | grep -v '^[[:space:]]*$' | head -4"; DIRS=".grok .config/grok" ;;
  *) echo "::error::agent must be cursor or grok"; exit 2 ;;
esac
if [ "$MODE" = reprobe ]; then
  # Force fresh provider probes without a restart: drop cached entries so the
  # runner's next heartbeat re-probes them (provider-inventory.ts), then show.
  C="$H/.loki/provider-probes.json"; IDS="${REPROBE_IDS:-cursor grok claude gemini}"
  [ -f "$C" ] && python3 - "$C" $IDS <<'PY'
import json,sys
p=sys.argv[1]; c=json.load(open(p))
for k in sys.argv[2:]: c.pop(k,None)
json.dump(c,open(p,'w'))
PY
  echo "→ dropped cached probes: $IDS — the runner re-probes them on its next heartbeats (one at a time, up to 2 min each). Read results with builder-agents.yml probe_only=true."
  exit 0
fi
if [ "$MODE" = status ]; then
  echo "→ status: $(as_user "$STATUS" 2>&1 | head -5)"
  echo "→ login process: $(pgrep -u "$RUNNER_USER" -f "script -qfc $LOGIN" >/dev/null && echo still waiting || echo ended)"
  echo "→ log tail:"; clean | tail -15
  for u in $(getent passwd | cut -d: -f1 | grep '^lk-'); do
    uh=$(getent passwd "$u" | cut -d: -f6)
    for d in $DIRS; do [ -e "$H/$d" ] || continue; mkdir -p "$uh/$(dirname "$d")"; rm -rf "$uh/$d"; cp -a "$H/$d" "$uh/$d"; chown -R "$u:" "$uh/$d"; done
    echo "  copied creds to $u"
  done
  exit 0
fi
echo "→ before: $(as_user "$STATUS" 2>&1 | head -3)"
pkill -u "$RUNNER_USER" -f "script -qfc $LOGIN" 2>/dev/null
rm -f "$LOG"
as_user "setsid nohup timeout 900 script -qfc '$LOGIN' '$LOG' </dev/null >/dev/null 2>&1 &"
echo "→ started detached: $LOGIN at $(date '+%H:%M %Z'); waits until $(date -d '+15 min' '+%H:%M %Z')"
for i in $(seq 1 25); do sleep 1; clean | grep -qiE 'https?://' && { sleep 2; break; }; done
echo "→ login output:"; clean | head -30
