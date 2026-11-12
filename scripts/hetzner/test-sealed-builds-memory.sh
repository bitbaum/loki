#!/usr/bin/env bash
# The builder's memory ceiling is never set below what it holds by accident.
# Run: bash scripts/hetzner/test-sealed-builds-memory.sh
set -uo pipefail
cd "$(dirname "$0")"
SEALED_CTL_LIB_ONLY=1
# shellcheck source=sealed-builds-ctl.sh
. ./sealed-builds-ctl.sh memory loki-box-runner
fail=0
check() { # <name> <got> <want prefix>
  case "$2" in "$3"*) echo "  ✓ $1" ;; *) echo "  ✗ $1: got '$2', want '$3…'"; fail=1 ;; esac
}
G=1073741824
check "a ceiling above what it holds is applied" "$(memory_set_decision $((6 * G)) 7)" apply
check "a ceiling below what it holds is refused" "$(memory_set_decision $((6 * G + G / 2)) 6)" refuse:the\ builder\ holds
check "equal is refused: the write needs room" "$(memory_set_decision $((6 * G)) 6)" refuse:the\ builder\ holds
check "force sets it anyway" "$(memory_set_decision $((6 * G + G / 2)) 6 force)" apply
check "an unknown holding is treated as nothing held" "$(memory_set_decision "[not set]" 6)" apply
check "words are refused" "$(memory_set_decision 0 lots)" refuse:the\ ceiling\ is\ a\ whole
check "empty is refused" "$(memory_set_decision 0 '')" refuse:the\ ceiling\ is\ a\ whole
check "one GiB is refused" "$(memory_set_decision 0 1)" refuse:the\ ceiling\ is\ between
check "a hundred GiB is refused" "$(memory_set_decision 0 100)" refuse:the\ ceiling\ is\ between
[ "$BUILDER_OOM_ADJ" -gt 0 ] && [ "$BUILDER_OOM_ADJ" -lt 1000 ] && echo "  ✓ the builder gives first, and is never the only thing that can" || { echo "  ✗ BUILDER_OOM_ADJ=$BUILDER_OOM_ADJ"; fail=1; }
[ "$fail" = 0 ] && echo "sealed-builds memory: all passed" || { echo "sealed-builds memory: FAILED"; exit 1; }
