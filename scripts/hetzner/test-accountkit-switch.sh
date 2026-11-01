#!/usr/bin/env bash
# accountkit-switch.sh: the parts that run before it reaches the box — what it
# refuses, and that the workflow's app list and the script's register agree.
set -euo pipefail
cd "$(dirname "$0")/../.."
S=scripts/hetzner/accountkit-switch.sh
W=.github/workflows/accountkit-switch.yml
fail=0
ok() { echo "  ok   — $1"; }
no() { echo "  FAIL — $1"; fail=1; }
sql="$(mktemp)"; trap 'rm -f "$sql"' EXIT

out="$(bash "$S" kivvi explode "$sql" 2>&1)" && no "an unknown action runs" || {
  grep -q "unknown action" <<< "$out" && ok "an unknown action is refused before anything runs" || no "unknown action: $out"; }
out="$(bash "$S" kivvi survey /nonexistent.sql 2>&1)" && no "a missing import SQL runs" || {
  grep -q "no import SQL" <<< "$out" && ok "a missing import SQL is refused" || no "missing SQL: $out"; }
out="$(HETZNER_IP=192.0.2.1 bash "$S" not-an-app survey "$sql" 2>&1)" && no "an unregistered app runs" || {
  grep -q "no AccountKit staging registered" <<< "$out" && ok "an app with no staging is refused" || no "unregistered: $out"; }

registered="$(sed -n "/^REGISTRY='/,/'\$/p" "$S" | sed "s/^REGISTRY='//" | cut -d'|' -f1 | sort | tr '\n' ' ')"
offered="$(grep -oP 'options: \[\K[^\]]*' "$W" | head -1 | tr -d ' ' | tr ',' '\n' | sort | tr '\n' ' ')"
[ "$registered" = "$offered" ] && ok "the workflow offers exactly the registered apps ($registered)" \
  || no "workflow offers [$offered], script registers [$registered]"

grep -q 'printf.*PROOF_PASSWORD' "$S" && ! grep -qE 'echo .*\$PROOF_(PASSWORD|HASH|EMAIL)' "$S" \
  && ok "the throwaway account's secrets reach the box but are never echoed" \
  || no "a proof secret may be printed"

[ "$fail" = 0 ] && echo "accountkit-switch: all checks pass" || { echo "accountkit-switch: failures"; exit 1; }
