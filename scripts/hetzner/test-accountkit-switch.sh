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

grep -q 'printf.*PROOF_PASSWORD' "$S" && ! grep -qE 'echo .*\$(PROOF_(PASSWORD2?|HASH2?|EMAIL)|OC_(EMAIL|PASSWORD))' "$S" \
  && ! grep -qE '(console\.(log|error)|step|stdout\.write)\(.*(\$\{OC_|[(,] *OC_(EMAIL|PASSWORD))' scripts/hetzner/accountkit-oidc-proof.mjs \
  && ! grep -qE '(console\.(log|error)|step)\(.*\$\{(EMAIL|NEW_PASSWORD|MAILTM_TOKEN|link)' scripts/hetzner/accountkit-reset-proof.mjs \
  && ! grep -qE 'echo .*\$(RESET_EMAIL|inbox_(token|password))' "$S" \
  && ok "the throwaway accounts' secrets reach the box and the browser but are never echoed" \
  || no "a proof secret may be printed"

sed -n '/^rollback() {/,/^}/p' "$S" | head -n 4 | grep -q 'only="$(native_only)"' \
  && grep -q "auth_passkeys" <<< "$(sed -n '/^native_only() {/,/^}/p' "$S")" \
  && ok "rollback first counts credentials only the shared tables hold, and refuses on any" \
  || no "rollback can empty tables that hold the only copy of a credential"

grep -q "options: \[survey, switch, rollback, prove\]" .github/workflows/accountkit-switch.yml \
  && grep -q 'survey|switch|rollback|prove)' "$S" \
  && ok "the workflow offers exactly the actions the script takes" \
  || no "the workflow's actions and the script's differ"

[ "$fail" = 0 ] && echo "accountkit-switch: all checks pass" || { echo "accountkit-switch: failures"; exit 1; }
