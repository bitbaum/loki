#!/usr/bin/env bash
# Every test suite that builds a git fixture must source
# scripts/test/lib/git-fixture-env.sh. Without it, the GIT_DIR the husky
# pre-push hook exports points the fixture's `git init`/`commit` at the REAL
# repo. That has happened three times: a single-file tree pushed over `main`
# (2026-08-15), a seed commit emptying an operator's branch (2026-08-20), and
# test-box-register-follow.sh committing onto the pushing branch and writing
# core.bare=true into the shared .git/config (2026-11-06). Each time the copy
# that lacked the guard was a new suite, so the guard is now a check.
#
# Run: bash scripts/hetzner/test-git-fixtures-isolated.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bad=0
checked=0
for f in "$ROOT"/scripts/hetzner/test-*.sh "$ROOT"/scripts/test/*.sh; do
  [ -f "$f" ] || continue
  grep -qE '(^|[^[:alnum:]_])(git|G|g)( -[cC] [^ ]+)* (init|clone)( |$)' "$f" || continue
  checked=$((checked + 1))
  if ! grep -q 'git-fixture-env\.sh' "$f"; then
    echo "  ✗ ${f#"$ROOT"/} builds a git fixture without sourcing scripts/test/lib/git-fixture-env.sh" >&2
    bad=1
  fi
done

[ "$bad" -eq 0 ] || exit 1
echo "  ✓ all $checked git-fixture suites source git-fixture-env.sh"
