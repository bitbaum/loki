#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin"
cat > "$tmp/bin/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${GH_REPLY:-}" > "$GH_CALL_LOG"
printf '%s' "${GH_REPLY:-}"
GH
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH" GH_CALL_LOG="$tmp/gh-call"

run() {
  : > "$tmp/output"
  GITHUB_OUTPUT="$tmp/output" "$here/receipt-visibility.sh" "$@"
}

run public bitbaum/kivvi >/dev/null
[[ $(cat "$tmp/output") == 'public=true' ]]
[[ ! -f "$tmp/gh-call" ]]

run private bitbaum/internal >/dev/null
[[ $(cat "$tmp/output") == 'public=false' ]]
[[ ! -f "$tmp/gh-call" ]]

export GH_REPLY=false
run auto bitbaum/kivvi >/dev/null
[[ $(cat "$tmp/output") == 'public=true' ]]
[[ $(cat "$tmp/gh-call") == false ]]

export GH_REPLY=true
run auto bitbaum/internal >/dev/null
[[ $(cat "$tmp/output") == 'public=false' ]]

export GH_REPLY=''
if run auto bitbaum/kivvi >/dev/null 2>&1; then
  echo 'unknown visibility unexpectedly succeeded' >&2
  exit 1
fi
[[ ! -s "$tmp/output" ]]

if run sometimes bitbaum/kivvi >/dev/null 2>&1; then
  echo 'invalid visibility unexpectedly succeeded' >&2
  exit 1
fi

echo 'receipt-visibility: explicit public/private, auto lookup and fail-closed cases passed'
