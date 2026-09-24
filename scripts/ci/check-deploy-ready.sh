#!/usr/bin/env bash
#
# Every deployed app must have CI, AND a Deploy workflow that can actually
# reach the box. Ratcheted: each count may fall, never rise.
#
# WHY
#
# ci-gate.sh exits 0 for "CI green" AND for "no CI configured" — both let a
# deploy through. That is a reasonable default and it means absence is
# indistinguishable from success: an app with no workflow ships every push
# completely unverified while looking exactly like one that passed.
#
# Substrata did that for a day. sinktattoo.com — a real client's site — is doing
# it now. Nothing reported either, because nothing was looking.
#
# The template now emits ci.yml with every new site, which fixes the future. This
# fixes the past: the exceptions are listed, counted, and the count can only go
# down. Same ratchet shape as the shared-inventory check.
#
# THE CD HALF (added 2026-08-28): camille-boulangerie had ci.yml — verify ran
# green on every push — and no deploy.yml at all, since it was created before
# new-site.sh existed. A fleet-wide audit found it by accident; nothing in
# this gate would have, because this gate only ever checked CI. "Has CI" and
# "actually deploys" are different claims, and conflating them is exactly the
# "absence reads as success" shape this file exists to rule out. So CD gets
# the same treatment: detected, counted, ratcheted — kept as its own counter
# so a CI regression and a CD regression can never cancel out under one
# shared number.
#
# TWO HALVES, AND WHY THEY ARE SEPARATE
#
# The first version of this gate inspected the sibling checkouts under DEV_ROOT
# and nothing else. That passes on the workstation, where all 15 are cloned, and
# fails in CI, where only this repo is — so it reported fifteen "missing" repos
# on a commit that touched none of them. A gate that judges state outside the
# commit is the exact thing that teaches everyone to pass --no-verify.
#
#   REGISTER INTEGRITY runs everywhere. apps.conf lives in THIS repo, so it is
#   in the diff, so CI can and must judge it.
#
#   FLEET INSPECTION runs only where the checkouts exist. Where they do not, it
#   is announced as not run — never silently skipped, because "no output" and
#   "all clear" looking identical is the bug this file exists to fix.
set -euo pipefail

# Resolved and USED before sourcing lib.sh, which sets its own $HERE and would
# otherwise silently repoint BASELINE_FILE at scripts/hetzner/. That collision
# made the ratchet read a missing file, fall back to the current count, and
# report "at baseline" for every value — a gate that could never fail.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
CI_BASELINE_FILE="$SELF_DIR/deploy-ready.baseline"
CD_BASELINE_FILE="$SELF_DIR/deploy-ready-cd.baseline"

. "$SELF_DIR/../hetzner/lib.sh"

# For migration_dirs — the applier's OWN list of where migrations live, so this
# gate cannot drift from the thing it is judging. Dummy args: the script wants
# four, and the lib-only return fires before any of them are used.
APPLY_SCHEMA_LIB_ONLY=1 . "$SELF_DIR/../hetzner/apply-schema.sh" gate /nonexistent - .

# ------------------------------------------------- half 1: register integrity
# In the diff, therefore CI's business. A malformed line here is what makes
# every downstream script reason about the wrong app.
FIELDS=12
bad=""; names=""; ports=""; total=0
while IFS= read -r line; do
  case "$line" in \#*|"") continue ;; esac
  total=$((total + 1))
  n=$(printf '%s' "$line" | awk -F'|' '{print NF}')
  name=$(printf '%s' "$line" | cut -d'|' -f1)
  port=$(printf '%s' "$line" | cut -d'|' -f2)
  [ "$n" = "$FIELDS" ] || bad="$bad\n    $name: $n fields, expected $FIELDS"
  case " $names " in *" $name "*) bad="$bad\n    $name: duplicate name" ;; esac
  names="$names $name"
  if grep -qE '^[0-9]+$' <<<"$port"; then
    case " $ports " in *" $port "*) bad="$bad\n    $name: port $port already taken" ;; esac
    ports="$ports $port"
  else
    bad="$bad\n    $name: port '$port' is not a number"
  fi
done < "$MANIFEST"

if [ -n "$bad" ]; then
  echo "✗ apps.conf is malformed:"
  printf "%b\n" "${bad#\\n}"
  echo "  The register is the SSOT for what runs here."
  exit 1
fi
echo "✓ register: $total entries, $FIELDS fields each, names and ports unique"

# -------------------------------------------------- half 2: fleet inspection
# Only meaningful where the sibling checkouts are present.
missing_ci=""; missing_cd=""; stale=""; silent_schema=""; elsewhere=""; present=0
shopt -s nullglob   # so `probe=(dir/[0-9]*.sql)` is EMPTY on no match, not a literal
while IFS='|' read -r name port domains repo appdir db rest; do
  case "$name" in \#*|"") continue ;; esac
  # A repo_path that is not under THIS machine's DEV_ROOT is an address on
  # another host — a site scaffolded directly on the box keeps /home/ubuntu/... —
  # so it can never exist here no matter how healthy the fleet is. Calling that
  # "drift" is the same category error this file's header warns about: judging
  # state that is not in front of you. dogfood-site-sep10-1201 did exactly that
  # on 2026-09-10 and failed pre-push for everyone on the laptop, on a register
  # row that was correct and a site that was serving 200.
  if [ ! -d "$repo" ]; then
    case "$repo" in
      "$DEV_ROOT"/*) stale="$stale $name" ;;
      *)             elsewhere="$elsewhere $name:$repo" ;;
    esac
    continue
  fi
  present=$((present + 1))
  # "Has CI" means a workflow that actually verifies something — a repo whose
  # only workflow is deploy.yml has a pipeline, not a gate.
  if ls "$repo"/.github/workflows/*.y*ml >/dev/null 2>&1 \
     && grep -lqE "^name: *CI|type-check|npm run verify|pnpm run verify|npm test|pnpm test" "$repo"/.github/workflows/*.y*ml 2>/dev/null; then
    :
  else
    missing_ci="$missing_ci $name"
  fi
  # "Has CD" means a workflow that can reach the box — the canonical deploy.yml
  # dispatches loki's selfhost-deploy.yml; anything hand-rolled must at
  # least trigger on push to main and call itself Deploy to count.
  if ls "$repo"/.github/workflows/*.y*ml >/dev/null 2>&1 \
     && grep -lqE "selfhost-deploy\.yml|^name: *Deploy" "$repo"/.github/workflows/*.y*ml 2>/dev/null; then
    :
  else
    missing_cd="$missing_cd $name"
  fi
  # A repo that ships migrations while declaring `db=-` is telling deploy.sh to
  # skip the schema step entirely — so the SQL is never applied anywhere, and
  # the deploy goes green because nothing failed. Nothing FAILED; nothing ran.
  #
  # botsmann did this for months: eleven migrations, /api/health serving
  # PGRST205 from a table that did not exist, every deploy green. Then
  # printcraft did it too — five more the pipeline never saw (#407). Twice is a
  # class, and the third is what this exists to prevent.
  #
  # A zero-check, not a ratchet: no app violates this today, so any occurrence
  # is a regression rather than inherited debt.
  case "$db" in
    -|"")
      for layout in drizzle prisma supabase; do
        while IFS= read -r cand; do
          probe=("$cand"/[0-9]*.sql)
          if [ "${#probe[@]}" -gt 0 ] || { [ "$layout" = prisma ] && [ -d "$cand" ]; }; then
            rel="${cand#"$repo"/}"; rel="${rel#./}"   # app_dir "." leaves a ./ that reads as noise
            silent_schema="$silent_schema $name:$rel"
            break 2
          fi
        done < <(migration_dirs "$layout" "$repo" "$appdir")
      done
      ;;
  esac
done < <(grep -v '^#' "$MANIFEST")

if [ "$present" = 0 ]; then
  echo "· fleet inspection NOT RUN: none of the $total checkouts exist under $DEV_ROOT."
  echo "  Expected in CI, which clones this repo only. Run it where the fleet lives:"
  echo "    bash scripts/ci/check-deploy-ready.sh"
  exit 0
fi

# Announced, never silently skipped: these rows are also invisible to the CI and
# CD counters below, because a repo that is not here cannot be inspected. Saying
# so is the difference between "we looked and it was fine" and "we never looked",
# which is the distinction this whole file exists to keep.
if [ -n "$elsewhere" ]; then
  echo "· not checkable here — repo_path lives on another host:"
  for r in $elsewhere; do echo "    ${r%%:*} -> ${r#*:}"; done
  echo "  Not drift: verify these on the box, not from the laptop."
fi

# A missing checkout is a REGISTER problem, not a CI problem. Reporting it as
# "no CI" sent me to add a workflow to a repo that already had one — the real
# fault was apps.conf pointing at /home/g/dev/s-ink, which does not exist.
# Distinguish them, or the gate lies about what to fix.
if [ -n "$stale" ]; then
  echo "✗ apps.conf points at repo paths that do not exist:"
  for r in $stale; do echo "    $r"; done
  echo "  $present of $total checkouts were found, so this is drift, not a bare"
  echo "  environment. Fix the path in apps.conf or clone the repo."
  exit 1
fi

failed=0

if [ -n "$silent_schema" ]; then
  echo "✗ app(s) ship migrations but declare db=- , so the schema step never runs:"
  for m in $silent_schema; do
    echo "    ${m%%:*} — migrations in ${m#*:}, applied nowhere"
  done
  echo
  echo "  deploy.sh skips apply-schema.sh entirely when db is '-'. The deploy"
  echo "  then goes green because nothing failed — nothing ran. This is how"
  echo "  botsmann served PGRST205 for months, and printcraft after it."
  echo "  Set the db field: a host database name, or supabase:<schema>."
  failed=1
fi

ci_count=$(echo $missing_ci | wc -w | tr -d ' ')
ci_baseline=$(cat "$CI_BASELINE_FILE" 2>/dev/null || echo "$ci_count")

if [ "$ci_count" -gt "$ci_baseline" ]; then
  echo "✗ $ci_count deployed app(s) have no CI, up from a baseline of $ci_baseline:"
  for m in $missing_ci; do echo "    $m — deploys unverified on every push"; done
  echo
  echo "  A new app without CI is a regression. Add .github/workflows/ci.yml"
  echo "  (scripts/site-template/.github/workflows/ci.yml is the one the scaffold emits)."
  failed=1
elif [ "$ci_count" -lt "$ci_baseline" ]; then
  echo "✓ CI: $ci_count without it (was $ci_baseline) — lower the baseline:"
  echo "    echo $ci_count > $CI_BASELINE_FILE"
elif [ "$ci_count" -gt 0 ]; then
  echo "✓ CI: $ci_count of $present inspected app(s) still without it (at baseline):$missing_ci"
else
  echo "✓ CI: all $present inspected apps have it"
fi

cd_count=$(echo $missing_cd | wc -w | tr -d ' ')
cd_baseline=$(cat "$CD_BASELINE_FILE" 2>/dev/null || echo "$cd_count")

if [ "$cd_count" -gt "$cd_baseline" ]; then
  echo "✗ $cd_count deployed app(s) have no Deploy workflow, up from a baseline of $cd_baseline:"
  for m in $missing_cd; do echo "    $m — a green push here has never once reached the box"; done
  echo
  echo "  A new app without CD is a regression. Add .github/workflows/deploy.yml"
  echo "  (scripts/site-template/.github/workflows/deploy.yml is the one the scaffold emits)."
  failed=1
elif [ "$cd_count" -lt "$cd_baseline" ]; then
  echo "✓ CD: $cd_count without it (was $cd_baseline) — lower the baseline:"
  echo "    echo $cd_count > $CD_BASELINE_FILE"
elif [ "$cd_count" -gt 0 ]; then
  echo "✓ CD: $cd_count of $present inspected app(s) still without it (at baseline):$missing_cd"
else
  echo "✓ CD: all $present inspected apps have it"
fi

[ "$failed" = 0 ]
