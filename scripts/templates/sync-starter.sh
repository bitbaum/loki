#!/usr/bin/env bash
#
# scripts/site-template IS bitbaum/fleet templates/app — the one starter every
# new product is created from — copied here at a pinned fleet commit, because
# new-site.sh runs on the box (no network promise) and the kickoff seeds a repo
# from server code. The copy is the bug unless something proves it is a copy,
# so this script is the only way the directory changes, and it records which
# fleet commit it came from in scripts/site-template/.fleet-source.
#
#   sync-starter.sh                 # copy fleet main, pin its commit
#   sync-starter.sh --ref <sha>     # copy a specific fleet commit
#   sync-starter.sh --check         # is the copy byte-identical to the pinned commit?
#   FLEET_DIR=~/dev/fleet sync-starter.sh --from-dir   # copy a local checkout's working tree (development only; pins "local")
#
# After copying it regenerates src/lib/starter-app.generated.ts, the kickoff's
# file map of the same tree (scripts/templates/generate-starter-files.ts).
# Never edit scripts/site-template by hand: change fleet, then sync.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd "$HERE/../.." && pwd -P)"
DEST="$ROOT/scripts/site-template"
PIN="$DEST/.fleet-source"
FLEET_REPO="${FLEET_REPO:-bitbaum/fleet}"

MODE=sync; REF=""; FROM_DIR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check; shift ;;
    --ref) REF="$2"; shift 2 ;;
    --from-dir) FROM_DIR=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fetch_ref() { # <sha> -> $WORK/app
  local sha="$1"
  curl -sSfL --retry 3 "https://codeload.github.com/$FLEET_REPO/tar.gz/$sha" -o "$WORK/fleet.tgz"
  mkdir -p "$WORK/x"
  tar -xzf "$WORK/fleet.tgz" -C "$WORK/x"
  local top
  top="$(find "$WORK/x" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [ -d "$top/templates/app" ] || { echo "fleet@$sha has no templates/app" >&2; exit 1; }
  mv "$top/templates/app" "$WORK/app"
}

if [ "$MODE" = check ]; then
  [ -f "$PIN" ] || { echo "✗ $PIN missing — run scripts/templates/sync-starter.sh" >&2; exit 1; }
  sha="$(tr -d '[:space:]' < "$PIN")"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "✗ $PIN does not pin a fleet commit ('$sha') — a local copy must not be merged" >&2; exit 1; }
  fetch_ref "$sha"
  if diff -r -q --exclude=.fleet-source "$WORK/app" "$DEST" >"$WORK/diff" 2>&1; then
    echo "✓ scripts/site-template is fleet templates/app at $sha"
    exit 0
  fi
  echo "✗ scripts/site-template differs from fleet templates/app at $sha:" >&2
  sed 's/^/    /' "$WORK/diff" >&2
  echo "  Change the starter in bitbaum/fleet, then run scripts/templates/sync-starter.sh." >&2
  exit 1
fi

if [ "$FROM_DIR" = 1 ]; then
  [ -d "${FLEET_DIR:-}/templates/app" ] || { echo "FLEET_DIR must point at a fleet checkout" >&2; exit 2; }
  cp -a "$FLEET_DIR/templates/app" "$WORK/app"
  rm -rf "$WORK/app/node_modules" "$WORK/app/.next"
  sha="local"
else
  if [ -z "$REF" ]; then
    REF="$(git ls-remote "https://github.com/$FLEET_REPO" refs/heads/main | cut -f1)"
  fi
  [[ "$REF" =~ ^[0-9a-f]{40}$ ]] || { echo "could not resolve fleet main to a commit ('$REF')" >&2; exit 1; }
  sha="$REF"
  fetch_ref "$sha"
fi

rm -rf "$DEST"
mv "$WORK/app" "$DEST"
printf '%s\n' "$sha" > "$PIN"
(cd "$ROOT" && npx tsx scripts/templates/generate-starter-files.ts)
echo "scripts/site-template ← $FLEET_REPO templates/app @ $sha"
