#!/usr/bin/env bash
#
# Install the box agent operating contract into the runner user's ~/.claude/CLAUDE.md.
#
# WHY THIS EXISTS
# ---------------
# An agent dispatched to the box works in ~/dev/<project> — a tree no editor is
# open on and the operator never looks at. If it does not commit, push, and open
# a PR, the work is simply lost. On the laptop the equivalent standing rules come
# from the operator's own global CLAUDE.md; the box had NO CLAUDE.md at all, so
# every cloud dispatch ran without them.
#
# The contract is a versioned file in this repo (box-agent-claude.md), not a
# hand-copied one. Copying the laptop's global file would be wrong twice: it is
# full of laptop-only context (zellij, the session registry, worktree helpers)
# that is false here, and a second copy drifts from the first the moment either
# changes.
#
# MERGE, DON'T CLOBBER
# --------------------
# The contract is written inside a marked block. Anything outside the markers is
# preserved verbatim, so a hand-added note on the box survives a redeploy, and
# re-running only ever rewrites the block. Same merge-only contract that
# claude-prep.ts holds for settings.json.
#
# Idempotent: safe to re-run on every deploy. Prints whether it changed anything.
#
# Usage:  bash scripts/hetzner/apply-box-agent-contract.sh [user@host]
set -euo pipefail

. "$(dirname "$0")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
HOST="${1:-$BOX_ROOT}"
RUNNER_OWNER="${LOKI_RUNNER_OWNER:-ubuntu}"
RUNNER_UHOME="$([ "$RUNNER_OWNER" = fcrunner ] && echo /home/fcrunner || echo /home/ubuntu)"
SRC="$(dirname "$0")/box-agent-claude.md"

BEGIN="<!-- BEGIN loki-managed: box agent contract -->"
END="<!-- END loki-managed: box agent contract -->"

[ -f "$SRC" ] || { echo "✗ missing contract source: $SRC" >&2; exit 1; }

echo "→ box agent contract: applying to ${HOST}:${RUNNER_UHOME}/.claude/CLAUDE.md"

# The body is STAGED as a file rather than piped: a pipe into `ssh … bash -s
# <<'REMOTE'` loses, because the heredoc claims stdin and the remote `cat` reads
# nothing. Staging also leaves the exact bytes on the box if this ever needs
# debugging.
STAGE="/tmp/loki-box-contract.$$.md"
{
  printf '%s\n' "$BEGIN"
  printf '%s\n' "<!-- Generated from scripts/hetzner/box-agent-claude.md — edit there, not here. -->"
  cat "$SRC"
  printf '%s\n' "$END"
} > "${STAGE}.local"
scp -q "${STAGE}.local" "$HOST:$STAGE"
rm -f "${STAGE}.local"

ssh "$HOST" "BLOCK_BEGIN='$BEGIN' BLOCK_END='$END' TARGET='$RUNNER_UHOME/.claude/CLAUDE.md' STAGE='$STAGE' bash -s" <<'REMOTE'
set -euo pipefail
block=$(cat "$STAGE")
rm -f "$STAGE"
mkdir -p "$(dirname "$TARGET")"
touch "$TARGET"
before=$(cat "$TARGET")

# Strip any previous managed block, keep everything else exactly as it was.
# awk (not sed) so the markers are matched literally and a body containing
# regex metacharacters cannot corrupt the file.
outside=$(awk -v b="$BLOCK_BEGIN" -v e="$BLOCK_END" '
  index($0, b) { skip = 1; next }
  index($0, e) { skip = 0; next }
  !skip        { print }
' "$TARGET")

# Managed block first, operator additions after it.
{
  printf '%s\n' "$block"
  # Only re-emit the remainder if it has real content, so we do not accumulate
  # blank lines on every redeploy.
  if grep -q '[^[:space:]]' <<<"$outside"; then
    printf '\n%s\n' "$(printf '%s' "$outside" | sed -e 's/[[:space:]]*$//')"
  fi
} > "$TARGET.tmp"
mv "$TARGET.tmp" "$TARGET"
chmod 0644 "$TARGET"

if [ "$before" = "$(cat "$TARGET")" ]; then
  echo "   unchanged"
else
  echo "   updated ($(wc -l < "$TARGET") lines)"
fi
REMOTE

echo "✓ box agent contract applied"
