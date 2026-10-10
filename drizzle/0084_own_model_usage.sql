-- Migration: own_model_usage — what a user's own keys spent, per vendor, per day.
--
-- WHY THIS EXISTS
-- A turn on the user's own key was recorded nowhere: not in ai_spend (that
-- rations the free pool) and not in ai_usage (that is the operator's view of
-- the free pool). Right for those two ledgers, but it left the person with no
-- count of their own to compare models by or check an invoice against.
-- One rollup row per (user, day, vendor, model); see src/db/schema/own-model-usage.ts.
--
-- Hand-written, like 0073–0083: drizzle/meta's snapshot is stale.
CREATE TABLE IF NOT EXISTS own_model_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  vendor text NOT NULL,
  model text NOT NULL,
  tokens integer NOT NULL DEFAULT 0,
  calls integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_own_model_usage_bucket UNIQUE (user_id, day, vendor, model)
);
CREATE INDEX IF NOT EXISTS idx_own_model_usage_user_day ON own_model_usage (user_id, day);
