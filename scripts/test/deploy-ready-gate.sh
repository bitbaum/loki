#!/usr/bin/env bash
# Tests for the deploy-readiness gate (scripts/ci/check-deploy-ready.sh).
#
# THE BUG THIS LOCKS SHUT
#
# The gate inspected the sibling checkouts under DEV_ROOT and nothing else. On
# the workstation all 15 are cloned, so it printed "all 15 deployed apps have
# CI". In CI only this repo is cloned, so the same commit printed fifteen
# missing repos and exited 1 — a red gate on a diff that touched none of them.
#
# That is the recurring failure mode across this fleet: a gate that judges state
# outside the commit. It is not a flake, it is a category error, and its cost is
# that everyone learns the gate is noise and starts passing --no-verify.
#
# So the split is asserted, both directions:
#   - what is IN the commit (apps.conf) must fail everywhere, CI included;
#   - what needs the fleet must be ANNOUNCED as not run, never silently passed
#     and never failed, when the fleet is absent.
#
# Builds fixtures in a temp dir by copying scripts/ and rewriting apps.conf.
# Touches nothing real, hits no network. Run: npm run test:deploy-ready-gate

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_SRC="$SCRIPT_DIR/.."
REAL_CONF="$SCRIPTS_SRC/hetzner/apps.conf"
TMP="$(mktemp -d)"
[ -n "$TMP" ] && [ -d "$TMP" ] || { echo "  ✗ mktemp -d produced no usable dir" >&2; exit 1; }
trap 'rm -rf "$TMP"' EXIT

PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }

# Each case gets a pristine copy. `cp -r a b` nests when b exists, which silently
# made one of these fixtures re-run the previous one's manifest while reporting
# a pass — so the destination is removed first, every time.
fixture() {
  rm -rf "$TMP/scripts"
  cp -r "$SCRIPTS_SRC" "$TMP/scripts"
  echo "$TMP/scripts/ci/check-deploy-ready.sh"
}
# Strip the fleet out of a fixture's register: every checkout path becomes one
# that cannot exist. This is what CI actually looks like.
no_checkouts() { sed -i 's#|/home/g/dev/#|/nonexistent/dev/#g' "$TMP/scripts/hetzner/apps.conf"; }

# A fake checkout with exactly the workflow files given, nothing else — lets
# CI/CD detection be tested directly instead of trusting that the real fleet
# happens to be fully provisioned right now.
fake_repo() {
  local dir="$1"; shift
  mkdir -p "$dir/.github/workflows"
  for wf in "$@"; do
    case "$wf" in
      ci)     printf 'name: CI\non: push\njobs:\n  check:\n    steps:\n      - run: npm run verify\n' > "$dir/.github/workflows/ci.yml" ;;
      deploy) printf 'name: Deploy\non:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    uses: bitbaum/loki/.github/workflows/selfhost-deploy.yml@main\n' > "$dir/.github/workflows/deploy.yml" ;;
      supabase-migrations)
        mkdir -p "$dir/supabase/migrations"
        printf 'CREATE TABLE IF NOT EXISTS t (id int);\n' > "$dir/supabase/migrations/001_init.sql" ;;
      drizzle-migrations)
        mkdir -p "$dir/drizzle"
        printf 'CREATE TABLE IF NOT EXISTS t (id int);\n' > "$dir/drizzle/0000_init.sql" ;;
    esac
  done
}

echo
echo "the register half runs everywhere — it is in the diff"

G=$(fixture)
awk -F'|' 'BEGIN{OFS="|"} !/^#/ && NF==12 && ++n==2 {$2=4022} {print}' "$REAL_CONF" \
  > "$TMP/scripts/hetzner/apps.conf"
OUT=$("$G" 2>&1); RC=$?
[ "$RC" = 1 ] || fail "a duplicate port must fail (rc=$RC)"
grep -q "already taken" <<<"$OUT" || fail "a duplicate port must say so: $OUT"
ok "a duplicate port fails"

# The one that matters: malformed register AND no fleet. CI sees exactly this.
no_checkouts
OUT=$("$G" 2>&1); RC=$?
[ "$RC" = 1 ] || fail "a duplicate port must fail in CI too, where no checkout exists (rc=$RC)"
ok "a duplicate port still fails when no checkout exists — CI judges the diff"

G=$(fixture)
awk -F'|' 'BEGIN{OFS="|"} !/^#/ && NF==12 && ++n==1 {NF=11} {print}' "$REAL_CONF" \
  > "$TMP/scripts/hetzner/apps.conf"
OUT=$("$G" 2>&1); RC=$?
[ "$RC" = 1 ] || fail "a short row must fail (rc=$RC)"
grep -q "fields, expected" <<<"$OUT" || fail "a short row must name the field count: $OUT"
ok "a row with the wrong field count fails"

G=$(fixture)
awk -F'|' 'BEGIN{OFS="|"} !/^#/ && NF==12 && ++n==2 {$1="substrata"} {print}' "$REAL_CONF" \
  > "$TMP/scripts/hetzner/apps.conf"
OUT=$("$G" 2>&1); RC=$?
[ "$RC" = 1 ] || fail "a duplicate name must fail (rc=$RC)"
ok "a duplicate app name fails"

echo
echo "the fleet half is announced, never guessed"

G=$(fixture); no_checkouts
OUT=$("$G" 2>&1); RC=$?
[ "$RC" = 0 ] || fail "a bare environment must not fail a good register (rc=$RC): $OUT"
ok "no checkouts on a valid register exits 0 — the CI red this file exists to kill"

grep -q "NOT RUN" <<<"$OUT" \
  || fail "a skipped fleet inspection must SAY so — silence reads as all-clear: $OUT"
ok "the skip is announced, not silent"

grep -q "register:" <<<"$OUT" \
  || fail "the register half must still run when the fleet is absent: $OUT"
ok "the register is still checked when the fleet is absent"

grep -q "all 15 deployed apps have it" <<<"$OUT" \
  && fail "a bare environment must never claim the fleet is verified: $OUT"
ok "a bare environment never claims the fleet passed"

echo
echo "CI and CD are detected independently — camille had one and not the other"

G=$(fixture)
fake_repo "$TMP/app-ci-only" ci
fake_repo "$TMP/app-cd-only" deploy
fake_repo "$TMP/app-both" ci deploy
{
  echo "app-ci-only|5001|a.example.com|$TMP/app-ci-only|.|-|t|demo|demo|-|-|-"
  echo "app-cd-only|5002|b.example.com|$TMP/app-cd-only|.|-|t|demo|demo|-|-|-"
  echo "app-both|5003|c.example.com|$TMP/app-both|.|-|t|demo|demo|-|-|-"
} > "$TMP/scripts/hetzner/apps.conf"
echo 0 > "$TMP/scripts/ci/deploy-ready.baseline"
echo 0 > "$TMP/scripts/ci/deploy-ready-cd.baseline"
OUT=$("$G" 2>&1); RC=$?
[ "$RC" = 1 ] || fail "an app missing CI or CD must fail the gate (rc=$RC): $OUT"
ok "an app missing CI or CD fails the gate"

grep -q "app-cd-only — deploys unverified" <<<"$OUT" \
  || fail "the CI-missing app must be named under CI, not CD: $OUT"
ok "the app with only a Deploy workflow is flagged for missing CI"

grep -q "app-ci-only — a green push here has never once reached the box" <<<"$OUT" \
  || fail "the CD-missing app must be named under CD, not CI: $OUT"
ok "the app with only a CI workflow is flagged for missing CD (camille's exact shape)"

grep -qE "app-both.*(unverified|never once reached)" <<<"$OUT" \
  && fail "the fully-provisioned app must not be flagged on either dimension: $OUT"
ok "an app with both CI and CD is flagged on neither"

echo
echo "drift is distinguished from a bare environment"

G=$(fixture)
sed -i 's#|/home/g/dev/petvity|#|/home/g/dev/petvity-TYPO|#' "$TMP/scripts/hetzner/apps.conf"
if [ -d /home/g/dev/petvity ]; then
  OUT=$("$G" 2>&1); RC=$?
  [ "$RC" = 1 ] || fail "one bad path among present checkouts is drift and must fail (rc=$RC)"
  grep -q "drift, not a bare" <<<"$OUT" || fail "drift must be named as drift: $OUT"
  ok "one bad path among present checkouts fails as drift"
else
  ok "drift case not exercised — the fleet is not checked out here (reported, not skipped silently)"
fi

echo
echo "a repo_path on ANOTHER host is announced, never called drift"
# dogfood-site-sep10-1201 was scaffolded straight onto the box, so its repo_path
# is /home/ubuntu/dev/... — a path that cannot exist on the laptop however
# healthy the fleet is. The gate called it drift and failed pre-push for
# everyone, on a register row that was correct and a site serving 200. "Missing
# here" and "belongs elsewhere" are different claims.

G=$(fixture)
sed -i 's#^petvity|\([^|]*\)|\([^|]*\)|/home/g/dev/petvity|#petvity|\1|\2|/home/ubuntu/dev/petvity|#' \
  "$TMP/scripts/hetzner/apps.conf"
if [ -d /home/g/dev/kivvi ]; then
  OUT=$("$G" 2>&1); RC=$?
  [ "$RC" = 0 ] || fail "a box-side repo_path must NOT fail the gate (rc=$RC): $OUT"
  grep -q "another host" <<<"$OUT" || fail "it must be announced, not silently dropped: $OUT"
  grep -q "petvity" <<<"$OUT" || fail "the announcement must name the app: $OUT"
  # Matched against the drift FAILURE line, not the bare word — the
  # announcement itself says "Not drift", which a naive grep reads as a hit.
  if grep -q "drift, not a bare" <<<"$OUT"; then
    fail "a path on another host must not be reported as drift: $OUT"
  fi
  ok "a repo_path on another host is announced and does not fail the gate"

  # The verdict must speak for what was INSPECTED. Saying "all 16 apps have CI"
  # while one was never looked at is the absence-reads-as-success shape again,
  # just one level up: the count itself does the overclaiming.
  grep -qE "CI: all [0-9]+ inspected apps have it" <<<"$OUT" \
    || fail "the CI verdict must be scoped to inspected apps: $OUT"
  insp=$(echo "$OUT" | sed -nE 's/.*CI: all ([0-9]+) inspected apps have it.*/\1/p')
  tot=$(echo "$OUT" | sed -nE 's/^✓ register: ([0-9]+) entries.*/\1/p')
  [ -n "$insp" ] && [ -n "$tot" ] && [ "$insp" -lt "$tot" ] \
    || fail "inspected ($insp) should be fewer than registered ($tot) here: $OUT"
  ok "the CI/CD verdict counts only apps it actually inspected"
else
  ok "off-host case not exercised — the fleet is not checked out here (reported, not skipped silently)"
fi

echo
echo "migrations with db=- — botsmann's root cause, and printcraft's after it"

# deploy.sh skips apply-schema.sh entirely when db is '-'. An app that ships
# migrations anyway has SQL that is applied nowhere, and a deploy that goes
# green because nothing failed — nothing ran.
G=$(fixture)
fake_repo "$TMP/app-silent-schema" ci deploy supabase-migrations
fake_repo "$TMP/app-declared" ci deploy supabase-migrations
fake_repo "$TMP/app-no-migrations" ci deploy
{
  echo "app-silent-schema|5011|d.example.com|$TMP/app-silent-schema|.|-|t|demo|demo|-|-|-"
  echo "app-declared|5012|e.example.com|$TMP/app-declared|.|supabase:demo|t|demo|demo|-|-|-"
  echo "app-no-migrations|5013|f.example.com|$TMP/app-no-migrations|.|-|t|demo|demo|-|-|-"
} > "$TMP/scripts/hetzner/apps.conf"
echo 0 > "$TMP/scripts/ci/deploy-ready.baseline"
echo 0 > "$TMP/scripts/ci/deploy-ready-cd.baseline"
OUT=$("$G" 2>&1); RC=$?

[ "$RC" = 1 ] || fail "migrations behind db=- must FAIL the gate (rc=$RC): $OUT"
ok "an app shipping migrations while declaring db=- fails the gate"

grep -q "app-silent-schema — migrations in supabase/migrations" <<<"$OUT" \
  || fail "the offending app and the directory must both be named: $OUT"
ok "it names the app and where the unapplied migrations are"

grep -q "app-declared" <<<"$OUT" \
  && fail "an app that DECLARES its database must not be flagged: $OUT"
ok "declaring a database clears it — the gate is about the lie, not about having SQL"

grep -q "app-no-migrations" <<<"$OUT" \
  && fail "db=- with no migrations is legitimate and must pass: $OUT"
ok "db=- with no migrations stays legitimate (4 real apps rely on this)"

# The drizzle layout is a different code path in the applier; both must be seen.
G=$(fixture)
fake_repo "$TMP/app-drizzle" ci deploy drizzle-migrations
echo "app-drizzle|5014|g.example.com|$TMP/app-drizzle|.|-|t|demo|demo|-|-|-" \
  > "$TMP/scripts/hetzner/apps.conf"
echo 0 > "$TMP/scripts/ci/deploy-ready.baseline"
echo 0 > "$TMP/scripts/ci/deploy-ready-cd.baseline"
OUT=$("$G" 2>&1); RC=$?
[ "$RC" = 1 ] || fail "a drizzle app with db=- must fail too (rc=$RC): $OUT"
ok "the drizzle layout is caught as well as supabase"

echo
echo "OK: $PASSED passed"
