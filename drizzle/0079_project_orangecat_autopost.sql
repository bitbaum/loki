-- Migration: user_projects.orangecat_autopost — consent to post this project's
-- build activity onto its OrangeCat wall.
--
-- WHY THIS EXISTS
-- "Publish to OrangeCat" was one decision that did two things: it created the
-- project's public page, and it enrolled the project in a live feed of
-- everything its agents did afterwards — every closed run, every changelog
-- entry — with no switch anywhere to stop the second without undoing the
-- first. Those are different asks. A page is a description someone wrote; a
-- feed is a diary that keeps writing itself. Wanting the funding page and not
-- the diary was not expressible.
--
-- NULL = nobody has chosen, and promotion requires an explicit TRUE: an
-- unanswered question is not consent. Same three-state shape as auto_ship,
-- for the same reason — so the surface can ASK rather than show a switch that
-- looks like a decision someone already made.
--
-- THE BACKFILL IS THE ONE PLACE THIS IS INFERRED, and only where inferring it
-- changes nothing: a project that already carries an orangecat_project_id has
-- been posting to its wall since the day it was published. Defaulting those to
-- NULL would silently stop a feed its owner has been relying on, under the
-- banner of asking permission — a consent model that takes away what it was
-- introduced to protect. Every project published from now on answers the
-- question at publish time.
ALTER TABLE user_projects
  ADD COLUMN IF NOT EXISTS orangecat_autopost boolean;

UPDATE user_projects
  SET orangecat_autopost = true
  WHERE orangecat_project_id IS NOT NULL
    AND orangecat_autopost IS NULL;
