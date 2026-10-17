-- The owner asked for "orangecat-2" to be deleted (2026-10-17): a stray test
-- rebuild of the OrangeCat site, not a client. Deactivated rather than deleted
-- (the migration guard refuses DELETE, and is_active=false is what every
-- project list, the fleet map and bitbaum's private area already filter on).
-- Its site is taken off the box by the "Retire site" workflow.
UPDATE user_projects SET is_active = false WHERE name = 'orangecat-2';
