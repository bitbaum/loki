#!/usr/bin/env bash
# Install the chat agent's `fleetcrown` skill onto bitbaum.
#
# WHY THIS EXISTS. The skill that connects George's Telegram conversation to
# this app's action queue lived only at
#   /home/openclaw/.openclaw/workspace/skills/fleetcrown/
# on the box — unversioned, undiffable, and invisible to anyone reading this
# repo. Its most important property (what the chat agent is allowed to do with
# the calendar) was therefore a fact about one server's filesystem rather than a
# reviewed decision. It is now a file here, and this script is the only way it
# gets there.
#
# Also refreshes the `gog` safety shim's refusal message. The shim still blocks
# every external Google write — that is not being relaxed — but it used to send
# the agent to "George's FleetCrown approval queue" without saying HOW, and the
# skill had no booking command, so the advice dead-ended in "go and use the
# website yourself". It now names the command that actually works.
#
# Usage: bash scripts/openclaw/install-fleetcrown-skill.sh [user@host]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

HOST="${1:-ubuntu@167.233.22.31}"
SRC="scripts/openclaw/fleetcrown-skill"
DEST="/home/openclaw/.openclaw/workspace/skills/fleetcrown"
STAGE="/tmp/fleetcrown-skill-$$"

[ -d "$SRC" ] || { echo "✗ $SRC missing"; exit 1; }

echo "→ staging skill on $HOST"
# Two hops because the openclaw user's home is not writable by the ssh user:
# copy into /tmp as ubuntu, then move it into place with sudo. Ownership is set
# explicitly — a root-owned skill file is one the gateway cannot read, which
# fails as "the skill does not exist" rather than as a permission error.
ssh "$HOST" "rm -rf $STAGE && mkdir -p $STAGE"
scp -q -r "$SRC/." "$HOST:$STAGE/"
ssh "$HOST" "sudo mkdir -p $DEST && sudo cp -r $STAGE/. $DEST/ \
  && sudo chown -R openclaw:openclaw $DEST \
  && sudo chmod +x $DEST/scripts/fc.sh \
  && rm -rf $STAGE"

echo "→ refreshing the gog shim's refusal message"
# Only the message changes. The block list is untouched, and this is asserted
# below rather than assumed: a shim that stopped blocking would be a silent
# hole, so the install fails loudly if the calendar-write block is not there
# afterwards. Never "fix" that by removing the check.
ssh "$HOST" "sudo sed -i 's|route it through George.s FleetCrown approval queue, not directly.|use the fleetcrown skill instead: fc.sh book \"<title>\" <start> [end] [location] — it proposes the event through the approval queue and books it. Do NOT tell George to open a website.|' /usr/local/bin/gog"
ssh "$HOST" "grep -q '\"calendar create\"' /usr/local/bin/gog" \
  || { echo "✗ the gog shim no longer blocks calendar writes — refusing to leave it that way"; exit 1; }

echo "→ verifying"
ssh "$HOST" "sudo -u openclaw test -x $DEST/scripts/fc.sh && echo '  fc.sh executable by openclaw'"
ssh "$HOST" "sudo -u openclaw grep -c 'fc.sh book' $DEST/SKILL.md >/dev/null && echo '  SKILL.md documents book'"
echo "✓ fleetcrown skill installed on $HOST"
