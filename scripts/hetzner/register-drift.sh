#!/usr/bin/env bash
# register-drift.sh <box-apps.conf> <main-apps.conf> — does the box's register
# say what main says?
#
# register-site.sh runs ON THE BOX and writes its row into the box's checkout
# of apps.conf first; publish_register_row then opens a PR to carry the row to
# main. When that PR stalls (failing CI, then a conflict), the box and main
# hold two different registers and nothing says so. On 2026-10-31 biaslens had
# been on port 4038 in the box's register for nine days (#1404 never merged),
# main did not know the port, and #1481 gave 4038 to signin: Caddy sent
# signin.orangecat.ch to biaslens and every "HTTP 200" check passed.
#
# Reported by name, port and the columns that differ (rows hold names, ports,
# paths and statuses, no secrets; main's are public):
#   box-only   a row the box has and main does not   → exit 1
#   differs    the same name, a different row        → exit 1
#   main-only  a row main has and the box does not   → warning (the box's
#              checkout lags until it is pulled; its port allocator still
#              sees the listener, so this is a lag, not a collision)
set -euo pipefail

BOX_FILE="${1:?usage: register-drift.sh <box-apps.conf> <main-apps.conf>}"
MAIN_FILE="${2:?usage: register-drift.sh <box-apps.conf> <main-apps.conf>}"

rows() { grep -vE '^[[:space:]]*(#|$)' "$1" | awk -F'|' 'NF > 5' | sort -t'|' -k1,1; }
row_of() { awk -F'|' -v n="$1" '$1 == n { print; exit }' <<<"$2"; }

# The register's columns (apps.conf header). A "differs" line naming only port
# and status said nothing when those agreed: on 2026-11-01 biaslens, kivvi and
# vitareba differed with the same port and status on both sides, and finding
# out which side was right started with finding out what differed.
COLUMNS=(name port domains repo_path app_dir db owner kind status plan price since)
columns_differ() {
  local -a a b
  local i n
  IFS='|' read -r -a a <<<"$1"
  IFS='|' read -r -a b <<<"$2"
  n=${#a[@]}; [ "${#b[@]}" -gt "$n" ] && n=${#b[@]}
  for ((i = 0; i < n; i++)); do
    [ "${a[i]:-}" = "${b[i]:-}" ] && continue
    printf '          %s: box %s, main %s\n' "${COLUMNS[i]:-column$((i + 1))}" "${a[i]:-(none)}" "${b[i]:-(none)}"
  done
}

box_rows="$(rows "$BOX_FILE")"
main_rows="$(rows "$MAIN_FILE")"

bad=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  name="${line%%|*}"; port="$(cut -d'|' -f2 <<<"$line")"
  other="$(row_of "$name" "$main_rows")"
  if [ -z "$other" ]; then
    echo "box-only: $name (port $port) is in the box's register and not on main"
    bad=1
  elif [ "$other" != "$line" ]; then
    echo "differs:  $name (box port $port, main port $(cut -d'|' -f2 <<<"$other"); box status $(cut -d'|' -f9 <<<"$line"), main status $(cut -d'|' -f9 <<<"$other"))"
    columns_differ "$line" "$other"
    bad=1
  fi
done <<<"$box_rows"

while IFS= read -r line; do
  [ -n "$line" ] || continue
  name="${line%%|*}"
  [ -n "$(row_of "$name" "$box_rows")" ] || echo "main-only (box checkout lags): $name (port $(cut -d'|' -f2 <<<"$line"))"
done <<<"$main_rows"

if [ "$bad" = 1 ]; then
  echo "register drift: the box's apps.conf disagrees with main. Land the row on main (the box's register/<name> PR), or correct the box." >&2
  exit 1
fi
echo "register drift: none (box rows all on main, unchanged)"
