#!/usr/bin/env bash
# GENERATED FILE — DO NOT EDIT BY HAND.
# Source of truth: src/lib/control-states.ts (STATE_DEFINITIONS).
# Regenerate: npx tsx scripts/generate-bash-state-vocab.ts
#
# Variables exposed:
#   FC_STATE_KEYS              — space-separated list of all state keys
#   FC_LABEL_<KEY>             — short human label (badge text)
#   FC_DESCRIPTION_<KEY>       — one-line WHY this state is true
#   FC_COUNTER_CATEGORY_<KEY>  — chip bucket: working|waiting|idle|offline
#
# Usage from bash:
#   source "$(dirname "$0")/control-states.generated.sh"
#   echo "$FC_LABEL_OFFLINE"          # → "Offline"
#   echo "$FC_DESCRIPTION_OPEN_IDLE"  # → "Agent process detected …"


FC_STATE_KEYS='offline not_running recently_active tab_open open_idle working ready orchestration_ready closing completed'

FC_LABEL_OFFLINE='Offline'
FC_DESCRIPTION_OFFLINE='The builder hasn'\''t pushed fresh state for this project — we don'\''t know what'\''s happening right now.'
FC_COUNTER_CATEGORY_OFFLINE='offline'

FC_LABEL_NOT_RUNNING='Not running'
FC_DESCRIPTION_NOT_RUNNING='No agent process and no terminal tab detected for this project.'
FC_COUNTER_CATEGORY_NOT_RUNNING='idle'

FC_LABEL_RECENTLY_ACTIVE='Active recently'
FC_DESCRIPTION_RECENTLY_ACTIVE='No live agent process is visible to Loki, but a dispatch or run landed for this project recently — work likely happened in a terminal Loki can'\''t observe.'
FC_COUNTER_CATEGORY_RECENTLY_ACTIVE='idle'

FC_LABEL_TAB_OPEN='Tab open'
FC_DESCRIPTION_TAB_OPEN='Terminal workspace exists for this project but no agent process is running in it.'
FC_COUNTER_CATEGORY_TAB_OPEN='idle'

FC_LABEL_OPEN_IDLE='Agent idle'
FC_DESCRIPTION_OPEN_IDLE='Agent process detected but no recent lifecycle signal. It may be at a prompt, stalled, or simply quiet; Loki has no evidence that it asked you a question.'
FC_COUNTER_CATEGORY_OPEN_IDLE='idle'

FC_LABEL_WORKING='Working'
FC_DESCRIPTION_WORKING='Agent is mid-turn — actively reading files, calling tools, or writing.'
FC_COUNTER_CATEGORY_WORKING='working'

FC_LABEL_READY='Ready for next step'
FC_DESCRIPTION_READY='Stop hook fired recently — the agent finished a turn and is ready for the next instruction. The handoff lists the suggested next move.'
FC_COUNTER_CATEGORY_READY='waiting'

FC_LABEL_ORCHESTRATION_READY='Ready for next step'
FC_DESCRIPTION_ORCHESTRATION_READY='Latest orchestration run completed and produced a result. Pick the next intent or accept the suggested next-best.'
FC_COUNTER_CATEGORY_ORCHESTRATION_READY='waiting'

FC_LABEL_CLOSING='Closing'
FC_DESCRIPTION_CLOSING='Closing hook fired — the agent process is shutting down.'
FC_COUNTER_CATEGORY_CLOSING='idle'

FC_LABEL_COMPLETED='Completed'
FC_DESCRIPTION_COMPLETED='Closed hook fired — the agent exited cleanly.'
FC_COUNTER_CATEGORY_COMPLETED='idle'

# Returns 0 if the generated file looks structurally sane,
# 1 if the FC_STATE_KEYS variable is missing or empty.
fc_state_vocab_sanity_check() {
  [ -n "${FC_STATE_KEYS:-}" ] || return 1
  return 0
}
