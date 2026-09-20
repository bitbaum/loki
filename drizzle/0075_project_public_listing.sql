-- Migration: user_projects.listed_publicly — consent to appear in Loki's own
-- public catalogue at /fleet.
--
-- WHY THIS EXISTS
-- /fleet is unauthenticated and speaks for the PRODUCT. Until now it resolved a
-- single account — `getSelfImprovementTarget()`, which is "whoever owns the
-- oldest entity named 'loki'" — and listed every project that account had, via
-- getUserProjects. Two things were wrong with that in a multi-tenant product:
--
--   1. No decision was ever recorded. A project appeared on a public page
--      because it existed, not because anyone said it could. Every OTHER public
--      surface in this repo (the landing hero, /u/[username]) already goes
--      through getPublicProjects; /fleet was the only one that did not.
--   2. WHICH account got published was a side effect of the self-improvement
--      loop's notion of "which product am I improving". If that entity is ever
--      reseeded or removed, the next-oldest project named "loki" wins and a
--      different tenant's whole project list becomes Loki's front page.
--
-- The column fixes (1) and lets the query fix (2): the page now asks for rows
-- that carry consent instead of rows that belong to a chosen account.
--
-- DEFAULT false IS THE WHOLE POINT. A tenant joining Loki must never be
-- enrolled in the product's shop window by signing up. Opting in is a decision
-- they take per project, the same shape as the existing "Publish to OrangeCat"
-- opt-in that user_projects.orangecat_project_id already records.
--
-- A user's OWN profile (/u/[username]) is a different question and is not
-- touched here: that page is the user speaking about themselves, and it was
-- already scoped by getPublicProjects.
ALTER TABLE user_projects
  ADD COLUMN IF NOT EXISTS listed_publicly boolean NOT NULL DEFAULT false;

-- BACKFILL — keep the page that exists today exactly as it is.
--
-- The catalogue at /fleet is the studio's own portfolio and is meant to be
-- public ("This is the studio's whole catalogue", in the page's own words), so
-- the account publishing it today has already made this decision in substance.
-- Recording it here means the deploy changes no pixel for them while every
-- other account starts at false.
--
-- Scoped to is_active so retired projects drop off rather than silently
-- inheriting consent. If no entity named 'loki' exists the subquery is NULL,
-- the UPDATE matches nothing, and a fresh database simply starts empty.
UPDATE user_projects
SET listed_publicly = true
WHERE is_active = true
  AND user_id = (
    SELECT user_id
    FROM entities
    WHERE name = 'loki'
    ORDER BY created_at ASC
    LIMIT 1
  );
