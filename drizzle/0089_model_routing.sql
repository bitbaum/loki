-- Migration: Auto decides which model answers which kind of turn.
-- `model_stance` is the person's stance (thrifty / balanced / best, see
-- lib/models/auto-picks.ts); `user_model_tiers` holds the picks they set by
-- hand per tier — the computed ones are not stored, they follow the catalogue.
-- Hand-written, like 0073–0088.
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS model_stance text NOT NULL DEFAULT 'balanced';
CREATE TABLE IF NOT EXISTS user_model_tiers (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier text NOT NULL,
  vendor text NOT NULL,
  model text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tier)
);
