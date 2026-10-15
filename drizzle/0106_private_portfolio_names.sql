-- Names and purpose lines for client work shown in bitbaum's private area.
-- Several rows still carried their repository slug as a name and the kickoff
-- prompt ("Develop a new version of this existing website: …") as a purpose.
-- A row with no slug and no repository takes its slug from its name, so the old
-- name is kept as the slug first: the address and hosting join do not move.
-- A rename that would collide with an existing name is skipped, not failed.
-- Data only: UPDATEs, no schema change.

UPDATE user_projects
SET slug = CASE WHEN coalesce(slug, '') = '' AND coalesce(git_url, '') = '' THEN name ELSE slug END,
    name = 'Vita'
WHERE name = 'vitareba'
  AND NOT EXISTS (SELECT 1 FROM user_projects o WHERE o.user_id = user_projects.user_id AND o.name = 'Vita');
--> statement-breakpoint
UPDATE user_projects
SET slug = CASE WHEN coalesce(slug, '') = '' AND coalesce(git_url, '') = '' THEN name ELSE slug END,
    name = 'AOZ Begleitung'
WHERE name = 'aoz-begleitung'
  AND NOT EXISTS (SELECT 1 FROM user_projects o WHERE o.user_id = user_projects.user_id AND o.name = 'AOZ Begleitung');
--> statement-breakpoint
UPDATE user_projects
SET slug = CASE WHEN coalesce(slug, '') = '' AND coalesce(git_url, '') = '' THEN name ELSE slug END,
    name = 'Farmacia del Parco',
    description = 'The pharmacy''s website, rebuilt: services, opening hours and booking.'
WHERE name = 'farmaciadelparco'
  AND NOT EXISTS (SELECT 1 FROM user_projects o WHERE o.user_id = user_projects.user_id AND o.name = 'Farmacia del Parco');
--> statement-breakpoint
UPDATE user_projects
SET slug = CASE WHEN coalesce(slug, '') = '' AND coalesce(git_url, '') = '' THEN name ELSE slug END,
    name = 'PrintCraft'
WHERE name = 'printcraft'
  AND NOT EXISTS (SELECT 1 FROM user_projects o WHERE o.user_id = user_projects.user_id AND o.name = 'PrintCraft');
--> statement-breakpoint
UPDATE user_projects
SET slug = CASE WHEN coalesce(slug, '') = '' AND coalesce(git_url, '') = '' THEN name ELSE slug END,
    name = 'Reparaturbonus',
    description = COALESCE(NULLIF(description, ''), 'Repair instead of replace: the City of Zürich''s repair bonus, as it should work.')
WHERE name = 'reparaturbonus-zh'
  AND NOT EXISTS (SELECT 1 FROM user_projects o WHERE o.user_id = user_projects.user_id AND o.name = 'Reparaturbonus');
--> statement-breakpoint
UPDATE user_projects
SET slug = CASE WHEN coalesce(slug, '') = '' AND coalesce(git_url, '') = '' THEN name ELSE slug END,
    name = 'Xhiva Art',
    description = 'An artist''s website, rebuilt.'
WHERE name LIKE 'xhiva-art-refresh-%'
  AND NOT EXISTS (SELECT 1 FROM user_projects o WHERE o.user_id = user_projects.user_id AND o.name = 'Xhiva Art');
--> statement-breakpoint
UPDATE user_projects SET description = 'A painter, shown.'
WHERE name = 'Annushka Wild Spirit Art' AND (description IS NULL OR description = '');
