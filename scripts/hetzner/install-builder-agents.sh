#!/usr/bin/env bash
# Box-side (run as root): give the cloud builder more than one engine.
#
# Until 2026-10-21 the builder had only Claude Code and Codex, so when both hit
# their quota the failover from #1367 had nowhere to go. This installs Cursor
# (cursor-agent), Grok and Antigravity (gemini) for the runner user into
# ~/.local/bin — already first on the runner unit's PATH, which is all the
# runner needs to report them installed (src/lib/agents/*.ts detectAvailable).
#
# Keys: GEMINI_API_KEY is copied from the orangecat app env into the runner env
# if the runner has none. XAI_API_KEY / CURSOR_API_KEY are left to the operator.
# NO secret value is ever printed — this repo's Action logs are public.
#
# Usage: install-builder-agents.sh [--no-restart]
set -uo pipefail
RUNNER_USER="${RUNNER_USER:-ubuntu}"
RUNNER_HOME="/home/$RUNNER_USER"
RUNNER_ENV="${RUNNER_ENV:-/opt/loki/runner/.env}"
KEY_SRC="${KEY_SRC:-/opt/orangecat/app/.env}"
BIN="$RUNNER_HOME/.local/bin"
as_user() { sudo -u "$RUNNER_USER" -H env PATH="$BIN:/usr/local/bin:/usr/bin:/bin" bash -lc "$1"; }

# key_present <file> <NAME> — set and non-empty, without reading it out.
key_present() { [ -r "$1" ] && grep -Eq "^(export )?$2=['\"]?[^'\"[:space:]]+" "$1"; }

if [ "${1:-}" != "--probe-only" ]; then
as_user "mkdir -p '$BIN'"
echo "→ Antigravity (gemini)"
as_user "npm install -g --prefix \$HOME/.local @google/gemini-cli >/dev/null 2>&1" || echo "  ⚠ gemini install failed"
echo "→ Cursor (cursor-agent)"
as_user "curl -fsS https://cursor.com/install | bash >/dev/null 2>&1" || echo "  ⚠ cursor install failed"
echo "→ Grok"
as_user "curl -fsSL https://x.ai/cli/install.sh | GROK_BIN_DIR=\$HOME/.local/bin bash >/dev/null 2>&1" || echo "  ⚠ grok install failed"


if key_present "$RUNNER_ENV" GEMINI_API_KEY; then
  echo "✓ GEMINI_API_KEY already in runner env"
elif key_present "$KEY_SRC" GEMINI_API_KEY; then
  cp -p "$RUNNER_ENV" "$RUNNER_ENV.bak.$(date +%s)"
  { echo; grep -E "^(export )?GEMINI_API_KEY=" "$KEY_SRC" | tail -1 | sed 's/^export //'; } >> "$RUNNER_ENV"
  echo "✓ GEMINI_API_KEY copied into runner env (value not shown)"
else
  echo "⚠ no GEMINI_API_KEY in $KEY_SRC — Antigravity installed but keyless"
fi

fi
echo "── report"
for a in claude codex cursor-agent grok gemini; do
  if [ -x "$BIN/$a" ] || as_user "command -v $a" >/dev/null 2>&1; then
    v="$(as_user "timeout 20 $a --version 2>/dev/null | head -1" || true)"; echo "installed  $a ${v}"
  else echo "missing    $a"; fi
done
for k in GEMINI_API_KEY XAI_API_KEY CURSOR_API_KEY; do
  key_present "$RUNNER_ENV" "$k" && echo "key set    $k" || echo "key unset  $k"
done
# Usable = the model actually answers with the runner's own key.
if key_present "$RUNNER_ENV" GEMINI_API_KEY; then
  # The env file is root-only (systemd reads it as root), so root loads it and
  # hands the runner user just that one variable — as the runner itself does.
  out="$( (set -a; . "$RUNNER_ENV"; set +a; cd /tmp && sudo -u "$RUNNER_USER" -H --preserve-env=GEMINI_API_KEY env PATH="$BIN:/usr/local/bin:/usr/bin:/bin" timeout 120 gemini -p 'Reply with exactly: PONG' 2>&1) | tail -15)"
  if case "$out" in *PONG*) true ;; *) false ;; esac; then echo "probe      gemini ok"
  else
    # Show WHY, with any long token-looking string masked (public logs).
    echo "probe      gemini FAILED:"
    printf '%s\n' "$out" | tr -d '\r' | sed -E 's/[A-Za-z0-9_-]{24,}/<masked>/g' | cut -c1-300 | sed 's/^/           /'
  fi
fi

case "${1:-}" in --no-restart|--probe-only) exit 0 ;; esac
echo "── scheduling drain-then-restart of runner units"
for u in loki-box-runner $(systemctl list-units 'loki-box-runner@*' --no-legend --plain 2>/dev/null | awk '{print $1}' | sed 's/\.service$//'); do
  r="loki-runner-restart-${u//@/-}"
  systemctl stop "$r.service" 2>/dev/null || true
  systemctl reset-failed "$r.service" 2>/dev/null || true
  systemd-run --unit="$r" --collect --quiet /bin/bash /opt/loki/runner/scripts/drain-and-restart-runner.sh "$u" && echo "✓ $u restart scheduled"
done
