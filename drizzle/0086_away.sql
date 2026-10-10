-- Migration: "back in 30 minutes" — when the operator said they would be away
-- and when they promised to return, so the next screen they open leads with
-- what happened since. See src/lib/away.ts. Hand-written, like 0073–0085.
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS away_since timestamptz;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS away_until timestamptz;
