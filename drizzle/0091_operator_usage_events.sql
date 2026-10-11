-- Migration: what the operator does with a surface Loki built — shown, tapped,
-- rotated, dismissed. Append-only; surfaces and actions are SSOT in
-- src/config/usage-surfaces.ts. Hand-written, like 0073–0090.
CREATE TABLE IF NOT EXISTS operator_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  surface text NOT NULL,
  action text NOT NULL,
  target text,
  path text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_operator_usage_user_surface_time
  ON operator_usage_events (user_id, surface, created_at);
