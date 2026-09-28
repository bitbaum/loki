#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Two of this repo's dependencies are GitHub-hosted (`github:bitbaum/...` in
# package.json). pnpm downloads those as tarballs from codeload.github.com,
# which the cloud sandbox's network policy refuses (403), so a plain
# `pnpm install` cannot finish there — and every husky hook that re-checks
# dependencies fails with it. Git clones ARE allowed. So on the web this hook
# clones each such package at the exact commit the lockfile pins, builds it if
# it ships no dist, installs with those clones linked in, and restores
# package.json and pnpm-lock.yaml untouched. Nothing about the repository
# changes; only this session's node_modules does.
#
# Locally this does nothing: your machine can reach codeload.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
DEPS_DIR="${CLAUDE_PROJECT_DIR}/../.fleet-git-deps"
mkdir -p "$DEPS_DIR"

# pnpm's verify-deps-before-run compares node_modules with the lockfile and
# re-runs `pnpm install` when they differ — which, after linking clones, they
# always do. Turn the re-check off for this session; the install below is the
# install.
echo 'export npm_config_verify_deps_before_run=false' >> "$CLAUDE_ENV_FILE"
export npm_config_verify_deps_before_run=false

# name|owner/repo|sha for every github: dependency, sha from the lockfile.
mapping=$(node .claude/hooks/link-git-deps.mjs list)

if [ -z "$mapping" ]; then
  pnpm install --frozen-lockfile
  exit 0
fi

cp -p package.json "$DEPS_DIR/package.json.orig"
cp -p pnpm-lock.yaml "$DEPS_DIR/pnpm-lock.yaml.orig"
# -p keeps the originals' mtimes: the pre-push hook treats a lockfile newer than
# node_modules/.modules.yaml as a stale install.
restore() { cp -p "$DEPS_DIR/package.json.orig" package.json; cp -p "$DEPS_DIR/pnpm-lock.yaml.orig" pnpm-lock.yaml; }
trap restore EXIT

while IFS='|' read -r name repo sha; do
  dir="$DEPS_DIR/${repo#*/}"
  if [ ! -d "$dir/.git" ]; then
    GIT_LFS_SKIP_SMUDGE=1 git clone -q --depth 1 "https://github.com/$repo" "$dir"
  fi
  if [ "$(git -C "$dir" rev-parse HEAD)" != "$sha" ]; then
    git -C "$dir" fetch -q --depth 1 origin "$sha"
    git -C "$dir" checkout -q "$sha"
  fi
  # A package that ships no dist needs its own build (listkit builds on prepare).
  if [ ! -d "$dir/dist" ] && node -e 'process.exit(require(process.argv[1]).scripts?.build ? 0 : 1)' "$dir/package.json"; then
    (cd "$dir" && pnpm install --ignore-scripts >/dev/null && pnpm run build >/dev/null)
  fi
  # Point this session's install at the clone, in the manifest and the lockfile.
  node .claude/hooks/link-git-deps.mjs link "$name" "$dir"
done <<< "$mapping"

pnpm install --no-frozen-lockfile
echo "session-start: installed with $(echo "$mapping" | wc -l | tr -d ' ') GitHub-hosted package(s) linked from git clones"
