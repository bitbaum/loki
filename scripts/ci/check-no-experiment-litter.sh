#!/usr/bin/env bash
# An experiment must not outlive the experiment.
#
# On 2026-09-12 six sites from dogfood and site-factory runs were still live on
# *.orangecat.ch days later, with five GitHub repositories behind them. Two of
# them — "Velokiosk — Bike Repair at Zürich HB" and "Kaffeeklappe – Kaffee to go
# in Zürich Wiedikon" — read as real Zurich businesses that do not exist, on the
# founder's own domain. Nobody decided to keep them. They were simply never
# removed once the thing they proved was proved.
#
# The cost is not disk. It is a GitHub account nobody can read at a glance, a
# register whose rows stop meaning "a thing we run", and agents that read both
# as context and infer that half-finished experiments are the norm.
#
# The rule is drawn at the COMMITTED register, not at the box. Spinning a
# throwaway up for an hour is fine and leaves no trace here; committing its row
# is the moment a test becomes permanent. So a generated throwaway name must
# never appear in this file — no grace period, because there is nothing to wait
# for. This gate objects to forgetting, not to experimenting.
#
# It matches NAMES, not kinds. "kind=demo" was tried and is too blunt: a real
# product can sit at demo status for weeks while it finds its footing, and
# failing CI over that teaches people to widen the pattern instead of cleaning
# up. A name like factory-sep11-0040 has no such defence — no product is ever
# called that.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

REGISTER=${REGISTER:-scripts/hetzner/apps.conf}
[ -f "$REGISTER" ] || { echo "✗ $REGISTER missing — the register is gone"; exit 1; }

# Names a throwaway gets: a dated suffix from the generator (-sep10, -sep11-0040)
# or a prefix that says what it was for.
EXPERIMENT_RE='(^(dogfood|coldstart|factory|probe|e2e|scratch|throwaway)-)|(-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[0-9]{2}(-[0-9]{3,4})?$)'

stale=()
while IFS='|' read -r name rest; do
  case "$name" in ''|'#'*) continue ;; esac
  if grep -qEi "$EXPERIMENT_RE" <<<"$name"; then
    stale+=("$name")
  fi
done < "$REGISTER"

if [ ${#stale[@]} -gt 0 ]; then
  echo "✗ experiment(s) outliving the experiment — committed to the register:"
  for s in "${stale[@]}"; do echo "    $s"; done
  echo
  echo "  Clean up, do not widen the pattern. On the box:"
  echo "    bash scripts/hetzner/retire-site.sh <name> --mode delete --repo keep --go"
  echo "  then delete the repository from a machine whose token has delete_repo:"
  echo "    gh repo delete bitbaum/<name> --yes"
  echo "  and remove the row from $REGISTER in the same commit."
  echo
  echo "  If one is genuinely being kept, it is not an experiment any more:"
  echo "  give it a real name, so the register says what it is."
  exit 1
fi

echo "✓ no experiment litter: no generated throwaway name is committed to $REGISTER"
