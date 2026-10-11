-- Migration: what the person decided about a suggestion on /suggestions.
-- A suggestion is derived from their records on every load; only the answer
-- ("taken" / "dismissed", when) is stored. It hides the suggestion for a
-- window and is the record behind the page's own numbers. Hand-written,
-- like 0073–0090.
CREATE TABLE IF NOT EXISTS suggestion_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  suggestion_id text NOT NULL,
  decision text NOT NULL,
  label text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suggestion_decisions_user_created
  ON suggestion_decisions (user_id, created_at);
