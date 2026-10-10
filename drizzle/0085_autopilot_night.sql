-- Migration: the autopilot night — a run budget, a ledger of what each night
-- did, and the reason on a report the night filed away.
--
-- WHY THIS EXISTS
-- The night used to be `nudge-idle`: wake three idle projects with a generic
-- "pick the next-best action" prompt, with no limit on what that spent and
-- no record the owner could read in the morning. The night now works from
-- the feedback inbox under a per-account run budget, reads one site when
-- there is room, and writes one row per night. See src/config/autopilot-night.ts.
--
-- Hand-written, like 0073–0084: drizzle/meta's snapshot is stale.
ALTER TABLE beacon_settings ADD COLUMN IF NOT EXISTS night_runs integer NOT NULL DEFAULT 4;
ALTER TABLE site_feedback ADD COLUMN IF NOT EXISTS archive_reason text;
CREATE TABLE IF NOT EXISTS autopilot_nights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  night date NOT NULL,
  summary jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_autopilot_nights_user_night ON autopilot_nights (user_id, night);
