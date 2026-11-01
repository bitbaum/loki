#!/usr/bin/env bash
# box-register-follow.sh <checkout> <go: 0|1> [repo-url] — ON THE BOX, as
# ubuntu: bring the durable loki checkout (and so its apps.conf, the box's
# register) to main, or say exactly why not.
#
# register-site.sh does this itself before it registers a site ("adopt main's
# register when every local row is already on main"), so the checkout follows
# main only when someone registers a site. Between registrations nothing pulls
# it: on 2026-11-01 it sat on a 2026-10-07 commit, 362 behind, and
# register-drift.yml reported six rows main had since corrected, two rows it
# had added and one (orangecat-2) it had retired. This is that same adoption,
# on its own, from .github/workflows/box-register.yml.
#
# It refuses, changing nothing, when following main would lose something:
#   - the checkout is not on main, or has changes beyond scripts/hetzner/apps.conf;
#   - it has commits main does not (a fast-forward is the only move it makes);
#   - its register holds a row main does not have: that row is a site
#     registered here whose PR has not landed (publish it), or one main retired
#     that is still in this file (retire-site.sh removes it from here too).
# A row that differs is taken from main; the dry run names each one first, so
# a row the box has right is landed on main before this runs with go=1.
#
# Fetches main from the public repository URL, not the checkout's `origin`
# (whose remote-tracking ref may be anything). Keeps a copy of the replaced
# register in ~/.apps.conf.before-follow. Prints names and counts only.
set -euo pipefail

CHECKOUT="${1:?usage: box-register-follow.sh <checkout> <go> [repo-url]}"
GO="${2:-0}"
URL="${3:-https://github.com/bitbaum/loki.git}"
REG="scripts/hetzner/apps.conf"

cd "$CHECKOUT" || { echo "no checkout at $CHECKOUT" >&2; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "$CHECKOUT is not a git checkout" >&2; exit 1; }

# The same lock register-site.sh holds while it writes this register.
exec 9>"${TMPDIR:-/tmp}/loki-register-site.lock"
flock -w 60 -x 9 || { echo "a registration is running; retry shortly" >&2; exit 1; }

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = main ] || { echo "the checkout is on '$branch', not main; refusing" >&2; exit 1; }

other="$(git status --porcelain --untracked-files=no | cut -c4- | grep -vx "$REG" || true)"
if [ -n "$other" ]; then
  echo "the checkout has changes beyond $REG; refusing:" >&2
  printf '  %s\n' $other >&2
  exit 1
fi

git fetch -q "$URL" main
target="$(git rev-parse FETCH_HEAD)"
if ! git merge-base --is-ancestor HEAD "$target"; then
  echo "the checkout has $(git rev-list --count "$target..HEAD") commit(s) main does not; refusing (not a fast-forward)" >&2
  exit 1
fi

names() { grep -vE '^[[:space:]]*(#|$)' | awk -F'|' 'NF > 5 { print $1 }' | sort -u; }
main_reg="$(git show "$target:$REG")"
unpublished="$(comm -23 <(names < "$REG") <(names <<<"$main_reg"))"
if [ -n "$unpublished" ]; then
  echo "the box's register has row(s) main does not; refusing:" >&2
  printf '  %s\n' $unpublished >&2
  echo "  land each on main (its register/<name> PR), or retire it (retire-site.sh removes it here)" >&2
  exit 1
fi

rows() { grep -vE '^[[:space:]]*(#|$)' | awk -F'|' 'NF > 5' | sort; }
changed="$(comm -23 <(rows < "$REG") <(rows <<<"$main_reg") | cut -d'|' -f1 | sort -u)"
added="$(comm -13 <(names < "$REG") <(names <<<"$main_reg"))"

echo "checkout at $(git rev-parse --short HEAD), main at $(git rev-parse --short "$target"): $(git rev-list --count "HEAD..$target") commit(s) to fast-forward"
[ -n "$changed" ] && { echo "rows that take main's value:"; printf '  %s\n' $changed; }
[ -n "$added" ] && { echo "rows main has and the box will gain:"; printf '  %s\n' $added; }

if [ "$GO" != 1 ]; then
  echo "DRY RUN — nothing changed. Dispatch again with go to follow main."
  exit 0
fi

cp -p "$REG" "$HOME/.apps.conf.before-follow"
git checkout -q -- "$REG"
git merge -q --ff-only "$target"
echo "✓ the checkout is at $(git rev-parse --short HEAD); its register is main's (the old one is ~/.apps.conf.before-follow)"
