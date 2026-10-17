-- A project started from a visitor's brief (/change, /take, the studio intake)
-- is someone else's site or app on the studio's account: client work, off every
-- public surface until they agree to be shown (src/lib/register/client-work.ts).
-- Rows created before start-brief-project set the flag carried NULL, so one
-- reached the public fleet map and the studio chat named it to a visitor
-- ("derhochhinhousepartyrenner-ch-refresh-68e1f49…", 2026-10-17).
-- An explicit answer (true or false) is kept; only the unanswered rows change.
-- Data only: UPDATEs, no schema change.

UPDATE user_projects
SET client_work = true
WHERE client_work IS NULL
  AND entity_project_id IN (
    SELECT id FROM entities WHERE coalesce(metadata->>'briefKind', '') <> ''
  );
--> statement-breakpoint
UPDATE user_projects
SET client_work = true
WHERE client_work IS NULL
  AND (name ~* '-refresh-[0-9a-f]{32}$' OR coalesce(slug, '') ~* '-refresh-[0-9a-f]{32}$');
