#!/usr/bin/env bash
# The litter gate is only worth having if it fires on the real shapes and stays
# quiet on real products. Both halves are tested, because a gate that cries wolf
# gets its pattern widened until it catches nothing.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$HERE/../ci/check-no-experiment-litter.sh"
pass=0; fail=0
ok() { if [ "$1" = 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "  ✗ $2"; fi }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
REAL="$HERE/../hetzner/apps.conf"
BEFORE="$(md5sum "$REAL" | cut -d" " -f1)"

run() { REGISTER="$1" bash "$CHECK" 2>&1; }

header='# name|port|domains|repo_path|app_dir|db|owner|kind|status|plan|price|since'
row() { echo "$1|4099|$1.orangecat.ch|/home/ubuntu/dev/$1|.|-|bitbaum|$2|$3|-|-|2026-09-11"; }

echo "→ it fires on every shape a generated throwaway takes"
for name in dogfood-site-sep10-1201 coldstart-sep10-2339 velokiosk-sep10 \
            factory-sep11-0040 probe-oct01-0930 e2e-probe-sep12 scratch-thing; do
  { echo "$header"; row "$name" client-site prospect; } > "$TMP/reg"
  out=$(run "$TMP/reg" || true)
  grep -q "$name" <<<"$out" && ok 0 "" || ok 1 "expected $name to be flagged"
done

echo "→ it stays quiet on the register we actually keep"
out=$(run "$REAL" || true)
grep -q "^✓" <<<"$out" && ok 0 "" || ok 1 "the real register must pass: $out"

echo "→ a real product is never flagged, whatever its kind or status"
# camille-boulangerie and sbb-fundbuero are demos that are real work. An earlier
# version of this gate judged by kind=demo and flagged both, which is exactly
# the false positive that gets a gate disabled.
{
  echo "$header"
  row camille-boulangerie demo demo
  row sbb-fundbuero demo demo
  row orangecat product live
  row hirnli client-app live
} > "$TMP/reg"
out=$(run "$TMP/reg" || true)
grep -q "^✓" <<<"$out" && ok 0 "" || ok 1 "real products must not be flagged: $out"

echo "→ a missing register is a failure, not a pass"
out=$(REGISTER="$TMP/nope.conf" bash "$CHECK" 2>&1 || true)
grep -qi "missing" <<<"$out" && ok 0 "" || ok 1 "a missing register should fail loudly"

echo "→ it never writes to the register it reads"
AFTER="$(md5sum "$REAL" | cut -d" " -f1)"
[ "$BEFORE" = "$AFTER" ] && ok 0 "" || ok 1 "the real register was modified by its own gate"

echo
echo "experiment-litter: $pass passed, $fail failed"
[ "$fail" = 0 ]
