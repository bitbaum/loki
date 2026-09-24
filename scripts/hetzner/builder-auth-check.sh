#!/usr/bin/env bash
#
# Is the box builder still allowed to think?
#
# The box-runner drives Claude Code with CLAUDE_CODE_OAUTH_TOKEN from
# /opt/loki/runner/.env. That token is minted by `claude setup-token` on a
# laptop and belongs to the Claude ACCOUNT that minted it. On 2026-09-14 the
# operator had moved to a new account the night before; the box kept the old
# token. Every dispatch from then on read "injected to running claude (pty)",
# printed 113 bytes, and went silent — the 113 bytes were
#   "Your organization has disabled Claude subscription access for Claude Code"
# and nothing anywhere said so. The run was reaped as `timeout` an hour later,
# the next one hung the same way, and the product's whole point (type it in,
# it happens) was quietly off.
#
# So: ask the builder a trivial question with the runner's own environment,
# hourly, and alert on the state FLIP (alert_transition), never per tick. The
# probe is the same command the runner uses, so a green probe is the builder
# working, not a proxy for it.
#
# States:
#   ok        — the model answered
#   disabled  — auth refused: account/org/subscription problem (needs a person)
#   down      — nothing answered (network, CLI missing, timeout)
#
# --report prints the verdict and exits 0 without touching alert state.
# PROBE_OUTPUT (tests) replaces the real probe with a canned answer.
set -uo pipefail   # NOT -e: a probe that dies must still produce a verdict
MON="${MON:-/opt/monitoring}"
RUNNER_ENV="${RUNNER_ENV:-/opt/loki/runner/.env}"
CLAUDE_BIN="${CLAUDE_BIN:-/home/ubuntu/.local/bin/claude}"
RUNNER_USER="${RUNNER_USER:-ubuntu}"
RUNNER_HOME="${RUNNER_HOME:-/home/$RUNNER_USER}"
PROBE_TIMEOUT="${PROBE_TIMEOUT:-90}"
REPORT_ONLY=0
[ "${1:-}" = "--report" ] && REPORT_ONLY=1
if [ "$REPORT_ONLY" = 0 ]; then
  . "$MON/lib-alert.sh"
fi

probe() {
  if [ -n "${PROBE_OUTPUT+x}" ]; then
    printf '%s' "$PROBE_OUTPUT"
    return "${PROBE_EXIT:-0}"
  fi
  local key tok
  key=$(grep -oE '^ANTHROPIC_API_KEY="?[^" ]*' "$RUNNER_ENV" 2>/dev/null | sed -E 's/^ANTHROPIC_API_KEY="?//')
  tok=$(grep -oE '^CLAUDE_CODE_OAUTH_TOKEN="?[^" ]*' "$RUNNER_ENV" 2>/dev/null | sed -E 's/^CLAUDE_CODE_OAUTH_TOKEN="?//')
  [ -x "$CLAUDE_BIN" ] || { echo "claude CLI missing at $CLAUDE_BIN"; return 3; }
  cd /tmp || return 3
  # Same precedence as the runner: an API key (the sanctioned automated path)
  # wins over a subscription token, and either wins over the sign-in file.
  if [ -n "$key" ]; then
    timeout "$PROBE_TIMEOUT" env HOME="$RUNNER_HOME" ANTHROPIC_API_KEY="$key" \
      "$CLAUDE_BIN" -p "reply with the single word ok" --output-format text 2>&1
  elif [ -n "$tok" ]; then
    timeout "$PROBE_TIMEOUT" env HOME="$RUNNER_HOME" CLAUDE_CODE_OAUTH_TOKEN="$tok" \
      "$CLAUDE_BIN" -p "reply with the single word ok" --output-format text 2>&1
  else
    # Exactly the runner's situation since 2026-09-15: no env credential, the
    # runner user's own `claude` sign-in on the box. That login WORKED while a
    # stale env token was overriding it — "no token" was never a verdict.
    [ -f "$RUNNER_HOME/.claude/.credentials.json" ] || {
      echo "no env credential and no sign-in at $RUNNER_HOME/.claude — run 'claude' once as $RUNNER_USER on the box"
      return 3
    }
    # Through a LOGIN shell, because that is how the runner launches an agent
    # (`bash -lic`), and a login shell sources ~/.bashrc — which on 2026-09-15
    # still exported the retired account's token. A probe that skipped the
    # profile said "ok" while every real agent was refused.
    timeout "$PROBE_TIMEOUT" sudo -u "$RUNNER_USER" -H bash -lc \
      "\"$CLAUDE_BIN\" -p \"reply with the single word ok\" --output-format text" 2>&1
  fi
}

out=$(probe); code=$?
# Never echo the token; the output is the model's or the CLI's own words.
first=$(printf '%s' "$out" | tr -d '\r' | sed -n '1p' | cut -c1-200)

DISABLED_RE='disabled Claude subscription|subscription access|not authorized|unauthori[sz]ed|invalid.*token|token.*(expired|invalid|revoked)|log ?in|authentication'
if grep -qiE "$DISABLED_RE" <<<"$out"; then
  state=disabled
elif [ "$code" -eq 0 ] && grep -qi 'ok' <<<"$out"; then
  state=ok
else
  state=down
fi

case "$state" in
  ok)       msg="builder auth ok — Claude Code answered with the runner's token" ;;
  disabled) msg="builder auth DISABLED — Claude Code refused the runner's token: \"$first\". Fix: put an Anthropic API key with a spending cap in /opt/loki/runner/.env as ANTHROPIC_API_KEY (the automated path must not ride a person's subscription — see docs/development/cloud-local-workflows.md), or for your own interactive builds re-mint a subscription token with \`claude setup-token\` on the CURRENT Claude account into CLAUDE_CODE_OAUTH_TOKEN; then systemctl restart loki-box-runner. Until then every dispatch hangs and times out." ;;
  down)     msg="builder probe got no answer (exit $code): \"$first\"" ;;
esac

if [ "$REPORT_ONLY" = 1 ]; then
  echo "$state: $msg"
  exit 0
fi
case "$state" in
  ok)       alert_transition builder_auth ok "✅" "$msg" ;;
  disabled) alert_transition builder_auth bad "🔑" "$msg" "builder auth (Claude Code token on the box)" ;;
  down)     alert_transition builder_auth bad "🔌" "$msg" "builder probe" ;;
esac
exit 0
