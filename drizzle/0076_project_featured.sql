-- Migration: user_projects.featured_at — the operator's editorial pick for the
-- landing hero, layered on top of the owner's consent (0075's listed_publicly).
--
-- WHY A SECOND GATE
-- 0075 stopped /fleet publishing a tenant because of who owned them. It did not
-- fix the LANDING, which called getHeroFleetSnapshot(getDefaultUser()) and put
-- that one account's projects in front of every visitor — consent was not even
-- consulted there, so a project with listed_publicly = false was still on the
-- homepage. (Observed: a throwaway test project, explicitly not listed, showing
-- in the hero console.)
--
-- The catalogue and the shop window are different spaces. /fleet can hold
-- everyone who opts in; the hero holds four. So:
--
--   consent  (listed_publicly, the OWNER's)     — may this be shown at all?
--   featured (featured_at,     the OPERATOR's)  — is this in the curated few?
--
-- Read together, always: src/db/queries/public-visibility.ts builds the
-- showcase predicate ON the catalogue predicate, so withdrawing consent removes
-- a project from the homepage immediately without anyone remembering to
-- un-feature it. Featuring can never override consent.
--
-- Same shape as site_feedback.featured_at, where this doctrine already held:
-- "raw visitor text NEVER auto-publishes — only rows the operator explicitly
-- featured surface here." Projects now work the way feedback already did.
--
-- Timestamp rather than boolean, for the same reason feedback uses one: it
-- orders the hero (most recently featured first) and records WHEN a decision
-- was taken, which a boolean throws away.
ALTER TABLE user_projects
  ADD COLUMN IF NOT EXISTS featured_at timestamptz;

-- Index the showcase read: tiny today, but this is the query on the busiest
-- unauthenticated page in the product, and it runs on every cold render.
CREATE INDEX IF NOT EXISTS idx_user_projects_featured
  ON user_projects (featured_at DESC)
  WHERE featured_at IS NOT NULL;

-- NO BACKFILL, deliberately.
--
-- 0075 backfilled consent because the catalogue was already public and the
-- account publishing it had made that decision in substance. Featuring is a new
-- editorial act that nobody has performed yet, so inventing one would be
-- fabricating a decision — and the hero's own doctrine is "never fabricated".
-- The hero therefore renders no project rows until the operator features some;
-- its fleet-wide counts carry the page until then, exactly as the feedback
-- strip's aggregates do before anything is featured there.
