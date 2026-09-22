#!/usr/bin/env bash
# retire-site.sh is the only script here that destroys things, so it is the one
# that has to be provably careful. Everything below runs against a throwaway
# apps.conf and never reaches the box: the plan path performs no action, which
# is exactly the property being tested.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/retire-site.sh"
pass=0; fail=0
ok() { if [ "$1" = 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "  ✗ $2"; fi }
# On a miss, SHOW what the command actually printed. A bare "expected output
# to mention 'DRY RUN'" is undiagnosable after the fact: this suite failed once
# inside a full `verify` on 2026-09-22 and passed 25/25 standalone, and there
# was no way to tell what the script had said instead. An assertion that hides
# its input turns an intermittent failure into a guess.
has() {
  if echo "$1" | grep -qi -- "$2"; then ok 0 ""; else
    ok 1 "expected output to mention '$2'"
    printf '      got (first 400 chars): %s\n' "$(printf '%s' "$1" | head -c 400 | tr '\n' '|')"
  fi
}
hasnt() { echo "$1" | grep -qi -- "$2" && { ok 1 "output must NOT mention '$2'"; } || ok 0 ""; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
MAN="$TMP/apps.conf"
cat > "$MAN" <<'CONF'
# name|port|domains|repo|app_dir|db|owner|kind|status|plan|price|since
demo-site|4099|demo-site.orangecat.ch|/home/ubuntu/dev/demo-site|.|-|cato|studio-site|live|-|-|2026-09-11
paying-client|4098|client.orangecat.ch|/home/ubuntu/dev/paying-client|.|-|acme|client-site|live|care|200|2026-09-01
CONF
retire() { MANIFEST="$MAN" bash "$SCRIPT" "$@" 2>&1; }

echo "→ it refuses to touch infrastructure"
for slug in loki orangecat bridge supabase; do
  out=$(retire "$slug" --mode delete --go || true)
  has "$out" "infrastructure"
done

echo "→ repo delete is refused when the host's token cannot do it"
# CI and the box both run a token WITHOUT delete_repo, a developer laptop may
# hold one, and the behaviour must not depend on which. So both answers are
# stubbed rather than inherited.
STUB="$(mktemp -d)"
printf '#!/usr/bin/env bash\necho "  - Token scopes: %s"\n' "'gist', 'repo', 'workflow'" > "$STUB/gh"
chmod +x "$STUB/gh"
out=$(PATH="$STUB:$PATH" retire demo-site --mode delete --repo delete || true)
has "$out" "no delete_repo scope"        # the plan says so before you commit
has "$out" "PLAN"                        # ...and is still a plan, not an abort
out=$(PATH="$STUB:$PATH" retire demo-site --mode delete --repo delete --go || true)
has "$out" "cannot delete repositories"  # asked to do it, it refuses outright
has "$out" "repo archive"                # and names the step that does work

printf '#!/usr/bin/env bash\necho "  - Token scopes: %s"\n' "'delete_repo', 'repo'" > "$STUB/gh"
out=$(PATH="$STUB:$PATH" retire demo-site --mode delete --repo delete || true)
has "$out" "cannot be undone"
hasnt "$out" "no delete_repo scope"  # a token that CAN delete is not lectured
rm -rf "$STUB"

echo "→ it refuses a mode it does not understand, and insists on one"
out=$(retire demo-site --mode nuke || true);      has "$out" "unknown mode"
out=$(retire demo-site || true);                  has "$out" "--mode is required"
out=$(retire --mode delete || true);              has "$out" "which site"
out=$(retire not-a-site --mode offline || true);  has "$out" "not in"

echo "→ a live client engagement needs a second hand"
out=$(retire paying-client --mode offline --go || true)
has "$out" "LIVE client engagement"
has "$out" "--force-client"
out=$(retire paying-client --mode offline --force-client || true)
has "$out" "PLAN"
hasnt "$out" "conversation first"

echo "→ without --go it is a plan, and the plan does nothing"
before=$(cat "$MAN")
out=$(retire demo-site --mode delete)
has "$out" "DRY RUN"
has "$out" "Nothing happened"
[ "$(cat "$MAN")" = "$before" ] && ok 0 "" || ok 1 "a dry run must not edit apps.conf"

echo "→ the plan names every artifact a delete removes"
for phrase in "apps.d/demo-site.caddy" "demo-site-app" "/opt/demo-site" "apps.conf row" "port 4099" "checkout" "GitHub Actions workflows" "HETZNER_SSH_PRIVATE_KEY"; do
  has "$out" "$phrase"
done

echo "→ a site taken offline keeps its workflows and its deploy key"
off=$(retire demo-site --mode offline)
hasnt "$off" "disable the repository"
hasnt "$off" "HETZNER_SSH_PRIVATE_KEY"

echo "→ offline is reversible and says so; it keeps what delete removes"
out=$(retire demo-site --mode offline)
has "$out" "apps.d/demo-site.caddy"
has "$out" "restore"
hasnt "$out" "/opt/demo-site (app"
hasnt "$out" "freeing port"

echo "→ the repository default follows the mode, and delete is never the default"
out=$(retire demo-site --mode delete);  has "$out" "archive"
out=$(retire demo-site --mode private); has "$out" "private"
out=$(retire demo-site --mode offline); has "$out" "left as it is"
out=$(retire demo-site --mode delete --repo delete); has "$out" "cannot be undone"

echo "→ restore regenerates rather than removes"
out=$(retire demo-site --mode restore)
has "$out" "sync-infra"
hasnt "$out" "rm -rf"

echo "→ no backtick command substitution (the sync-infra footgun)"
grep -n '`' "$SCRIPT" >/dev/null 2>&1 && ok 1 "retire-site.sh contains a backtick" || ok 0 ""

echo
echo "retire-site: $pass passed, $fail failed"
[ "$fail" = 0 ] || exit 1
