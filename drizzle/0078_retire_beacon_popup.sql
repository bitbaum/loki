-- 0078 — retire the beacon popup: drop its table and its two dead columns.
--
-- DESTRUCTIVE — apply-schema.sh will REFUSE this migration by design.
-- It was applied BY HAND and its tag recorded in public._deploy_schema_history,
-- per the procedure in scripts/hetzner/apply-schema.sh (header, and the
-- "apply the above by hand" branch of the destructive guard).
--
-- WHAT THIS REMOVES, AND WHY IT IS SAFE
--
-- The beacon popup was a frameless Chrome --app window at /beacon/live that
-- asked the operator what to do next when an agent went idle. It was retired
-- on 2026-06-11 (2391c6f7, "collapse 5 modes to off|on; delete strategist +
-- beacon popup"), which deleted the page and the /api/beacon/{[id],cancel,sse,
-- window/show,window/hide} routes — and left everything behind them standing.
--
--   * beacon_sessions — the popup's session store. Measured 2026-09-20:
--     ONE row, created 2026-06-08 23:39 UTC, three days BEFORE the retirement.
--     Nothing in the 104 days since. All three of its indexes had idx_scan = 0.
--     Its only reader was POST /api/beacon, whose only caller was
--     scripts/beacon.py, which nothing invoked (the Stop hook that ran it has
--     been `exit 0` since the same 2026-06-11 migration).
--
--   * beacon_settings.popup_mode — written by the Settings page, echoed by the
--     API, and branched on by nothing. Its production DEFAULT was still 'both',
--     a PyQt-era value the app's own zod enum (["web","disabled"]) rejects.
--     Choosing "Disabled" in the UI changed nothing anywhere.
--
--   * beacon_settings.min_idle_seconds — offered on /settings for about a year
--     as "Skip popup if you've been active in the last Ns". It was already
--     excluded from the query layer's shape on 2026-09-11, with the note that
--     "the knob described behaviour that did not exist".
--
-- What SURVIVES and is untouched: beacon_settings.auto_inject_mode (autopilot),
-- .countdown_seconds (the Control ready-banner), .whisper_model and
-- .transcription_provider (voice input). Those are live features that happen to
-- sit under the beacon name; only the popup is going.

DROP TABLE IF EXISTS beacon_sessions;

ALTER TABLE beacon_settings DROP COLUMN IF EXISTS popup_mode;
ALTER TABLE beacon_settings DROP COLUMN IF EXISTS min_idle_seconds;
