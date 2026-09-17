#!/usr/bin/env bash
# Install the chat agent's `loki` skill onto bitbaum.
#
# WHY THIS EXISTS. The skill connecting George's Telegram conversation to this
# app's action queue lived only at
#   /home/openclaw/.openclaw/workspace/skills/<old-name>/
# on the box — unversioned, undiffable, and unreachable by any gate here. So
# when the product was renamed on 2026-09-14 and the env file's keys were
# renamed with it, that script was not, and every command it offered began
# aborting on a missing variable. Listing the approval queue, approving,
# rejecting and dispatching were all dead from chat for days, silently: a skill
# that errors just makes the agent talk about something else.
#
# It is a file in this repo now, and this script is the only way it gets there.
#
# Also refreshes the `gog` safety shim's refusal message. The shim still blocks
# every external Google write — that is not being relaxed — but it used to send
# the agent to the approval queue without saying HOW, and the skill had no
# booking command, so the advice dead-ended in "go and use the website
# yourself". It now names the command that actually works.
#
# Usage: bash scripts/openclaw/install-loki-skill.sh [user@host]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

HOST="${1:-ubuntu@167.233.22.31}"
SRC="scripts/openclaw/loki-skill"
SKILLS="/home/openclaw/.openclaw/workspace/skills"
DEST="$SKILLS/loki"
STAGE="/tmp/loki-skill-$$"

[ -d "$SRC" ] || { echo "✗ $SRC missing"; exit 1; }

echo "→ staging skill on $HOST"
# Two hops because the openclaw user's home is not writable by the ssh user:
# copy into /tmp as ubuntu, then move it into place with sudo. Ownership is set
# explicitly — a root-owned skill file is one the gateway cannot read, which
# presents as "the skill does not exist" rather than as a permission error.
ssh "$HOST" "rm -rf $STAGE && mkdir -p $STAGE"
scp -q -r "$SRC/." "$HOST:$STAGE/"
ssh "$HOST" "sudo mkdir -p $DEST && sudo cp -r $STAGE/. $DEST/ \
  && sudo chown -R openclaw:openclaw $DEST \
  && sudo chmod +x $DEST/scripts/loki.sh \
  && rm -rf $STAGE"

echo "→ removing the superseded skill directory"
# Not optional tidying. Leaving the old directory in place leaves the agent
# holding two skills that claim the same job, one of which cannot run — and the
# broken one is the one it has been choosing. Two answers to one question is
# how this failure lasted as long as it did.
ssh "$HOST" "for d in $SKILLS/*/; do \
    [ \"\$d\" = '$DEST/' ] && continue; \
    if [ -f \"\$d/scripts/fc.sh\" ]; then echo \"  removing \$d\"; sudo rm -rf \"\$d\"; fi; \
  done"

echo "→ refreshing the gog shim's refusal message"
# Only the message changes. The block list is untouched, and that is ASSERTED
# below rather than assumed: a shim that silently stopped blocking would be a
# hole nobody would notice, so the install fails loudly if the calendar-write
# block is not still there afterwards. Never "fix" that by deleting the check.
ssh "$HOST" "sudo sed -i 's|route it through George.s [A-Za-z]* approval queue, not directly.|use the loki skill instead: loki.sh book \"<title>\" <start> [end] [location] — it proposes the event through the approval queue and books it. Do NOT tell George to open a website.|' /usr/local/bin/gog"
ssh "$HOST" "grep -q '\"calendar create\"' /usr/local/bin/gog" \
  || { echo "✗ the gog shim no longer blocks calendar writes — refusing to leave it that way"; exit 1; }

echo "→ verifying"
ssh "$HOST" "sudo -u openclaw test -x $DEST/scripts/loki.sh && echo '  loki.sh executable by openclaw'"
ssh "$HOST" "sudo -u openclaw grep -q 'loki.sh book' $DEST/SKILL.md && echo '  SKILL.md documents book'"
# The check that would have caught the rename breakage on the day it happened:
# run the thing as the user who runs it, and require real output. `pending`
# reads only, so this is safe to run on every install.
ssh "$HOST" "sudo -u openclaw bash $DEST/scripts/loki.sh pending >/dev/null" \
  && echo "  the skill authenticates and reads the queue" \
  || { echo "✗ the skill cannot reach the Loki API — check LOKI_AGENT_TOKEN in calendar-drain.env"; exit 1; }

echo "✓ loki skill installed on $HOST"
