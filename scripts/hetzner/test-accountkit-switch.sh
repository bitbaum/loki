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

C=scripts/hetzner/accountkit-cutover.sh
registry() { sed -n "/^REGISTRY='/,/'\$/p" "$1" | sed "s/^REGISTRY='//" | cut -d'|' -f1; }
registered="$( { registry "$S"; registry "$C"; } | sort | tr '\n' ' ')"
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

grep -q "options: \[survey, rehearse, switch, rollback, prove\]" "$W" \
  && grep -q 'survey|switch|rollback|prove)' "$S" \
  && grep -q 'survey|rehearse|switch|rollback|prove)' "$C" \
  && grep -q 'vitareba|aoz-begleitung)' "$W" \
  && ok "the workflow offers exactly the actions the scripts take; rehearse only through the cutover" \
  || no "the workflow's actions and the scripts' differ"

# accountkit-cutover.sh (Vitareba, AOZ): personal data, so its own guarantees.
out="$(bash "$C" vitareba explode "$sql" 2>&1)" && no "cutover: an unknown action runs" || {
  grep -q "unknown action" <<< "$out" && ok "cutover: an unknown action is refused" || no "cutover unknown action: $out"; }
out="$(HETZNER_IP=192.0.2.1 bash "$C" kivvi survey "$sql" 2>&1)" && no "cutover: an app it does not register runs" || {
  grep -q "not registered in accountkit-cutover.sh" <<< "$out" && ok "cutover: an unregistered app is refused" || no "cutover unregistered: $out"; }
! grep -qiE '^[^#]*\bTRUNCATE\b' "$C" \
  && sed -n '/^rollback() {/,/^}/p' "$C" | grep -q 'set_runtime ""' \
  && ! sed -n '/^rollback() {/,/^}/p' "$C" | grep -qE 'DELETE|DROP|proof_delete' \
  && ok "cutover: rollback empties AUTH_RUNTIME and restarts; nothing in it empties a table" \
  || no "cutover: rollback can remove credentials"
grep -q 'umask 077; cat >' "$C" && grep -q 'chmod 600 "$file"' "$C" \
  && ok "cutover: a dump is written 600 from its first byte" || no "cutover: a dump may be readable by others"
! grep -qE 'echo .*\$(PROOF_PASSWORD|SIGNUP_PASSWORD|LEGACY_HASH|PROOF_EMAIL|SIGNUP_EMAIL)' "$C" \
  && ok "cutover: no proof password, hash or address is echoed" || no "cutover: a proof secret may be printed"

[ "$fail" = 0 ] && echo "accountkit-switch: all checks pass" || { echo "accountkit-switch: failures"; exit 1; }
