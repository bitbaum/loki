-- Migration: the night asks first. The evening proposes tonight's plan with its
-- cost as an approval; an allowance ("run without asking until <date>, up to
-- $<cap> a night") is the only way a night runs unasked. See
-- src/config/autopilot-night.ts. Hand-written, like 0073–0086.
ALTER TABLE beacon_settings ADD COLUMN IF NOT EXISTS night_allow_until timestamptz;
ALTER TABLE beacon_settings ADD COLUMN IF NOT EXISTS night_cost_cap_usd real;
