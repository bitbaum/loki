#!/usr/bin/env bash
# A prospect preview's own address: the vhost rule (lib.sh preview_vhost) and
# attach-preview-host.sh --dry-run. No box, no DNS.
# Run: bash scripts/hetzner/test-preview-host.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }
# shellcheck source=lib.sh
source "$HERE/lib.sh"
set +e

echo
echo "the vhost makes the preview the whole of its host"
out=$(preview_vhost francesco francesco.orangecat.ch 4002)
head -1 <<<"$out" | grep -qx "francesco.orangecat.ch {" || fail "serves exactly its own host: $(head -1 <<<"$out")"
grep -q "rewrite @previewroot /p/francesco/index.html" <<<"$out" || fail "'/' must open the entry file, not the bare folder"
grep -q "rewrite @previewrest /p/francesco{uri}" <<<"$out" || fail "every other path moves under /p/<label>"
grep -q "@previewrest not path /p/francesco/\*" <<<"$out" || fail "an already-rewritten path must not be rewritten twice"
grep -q "header_up X-Preview-Root 1" <<<"$out" || fail "Loki must be told the preview is the root"
grep -q "lb_try_duration" <<<"$out" || fail "a deploy must not be an outage (verify.sh asserts this)"
grep -q "redir " <<<"$out" && fail "a preview host must not redirect"
ok "root, rest, root header and restart rule are all present"

echo
echo "attach-preview-host.sh --dry-run"
dry=$(bash "$HERE/attach-preview-host.sh" francesco --dry-run 2>&1); code=$?
[ "$code" = 0 ] || fail "a good label must pass (exit $code): $dry"
tail -1 <<<"$dry" | grep -qx "LIVE_URL=https://francesco.orangecat.ch/" || fail "last line is LIVE_URL: $(tail -1 <<<"$dry")"
ok "prints the vhost and LIVE_URL, changes nothing"

for bad in "Bar" "-bar" "bar-" "ba r" "a.b" "loki" "www" "p"; do
  out=$(bash "$HERE/attach-preview-host.sh" "$bad" --dry-run 2>&1); rc=$?
  { [ "$rc" = 1 ] || [ "$rc" = 2 ]; } || fail "'$bad' must be refused: $out"
done
ok "malformed and reserved labels are refused"

first=$(grep -v '^#' "$HERE/apps.conf" | grep . | head -1 | cut -d'|' -f3 | cut -d, -f1)
if [[ "$first" == *.orangecat.ch ]]; then
  out=$(bash "$HERE/attach-preview-host.sh" "${first%.orangecat.ch}" --dry-run 2>&1); [ $? = 1 ] || fail "a registered host must be refused: $out"
  ok "a host the register already serves is refused"
fi

echo
echo "an address must answer, not just be attached"
bash -n "$HERE/ensure-preview.sh" || fail "ensure-preview.sh must parse"
bash -n "$HERE/preview-create-on-box.sh" || fail "preview-create-on-box.sh must parse"
usage=$(bash "$HERE/ensure-preview.sh" bogus 2>&1); [ $? = 2 ] || fail "an unknown mode is a usage error: $usage"
grep -q "ERR_SSL_PROTOCOL_ERROR\|does not answer over HTTPS" "$HERE/ensure-preview.sh" || fail "the ensure script must fail when the host does not answer"
grep -q "cron:" "$HERE/../../.github/workflows/previews.yml" || fail "heal must run on a clock"
grep -q "add-mask::\$CODE" "$HERE/../../.github/workflows/previews.yml" || fail "a code given to the workflow must be masked in the logs"
grep -q 'echo.*\$CODE' "$HERE/preview-create-on-box.sh" && fail "the box script must never echo the code"
grep -q 'accessCode' "$HERE/preview-create-on-box.sh" || fail "the box script must mask the access code in the answer it prints"
ok "ensure/heal parse, fail loudly, run on a clock, and never print a code"

echo
echo "the owner's view can be checked without printing the key to it"
bash -n "$HERE/preview-check-on-box.sh" || fail "preview-check-on-box.sh must parse"
grep -q 'echo.*\$cookie' "$HERE/preview-check-on-box.sh" && fail "the check script must never echo the cookie"
grep -qE 'echo.*\$reply|cat "\$reply"|head -c.*\$reply' "$HERE/preview-check-on-box.sh" && fail "the check script must never print the app's answer (it carries the cookie)"
grep -q '_loki/before-after' "$HERE/preview-check-on-box.sh" || fail "the check must open the before-and-after tour"
grep -q '^website)' "$HERE/ensure-preview.sh" || fail "ensure-preview.sh must run the /change path (website mode)"
grep -q '^check)' "$HERE/ensure-preview.sh" || fail "ensure-preview.sh must open a preview as its owner (check mode)"
ok "website and check modes exist, open the tour, and keep the cookie off the log"

echo
echo "preview-host: $PASSED passed"
