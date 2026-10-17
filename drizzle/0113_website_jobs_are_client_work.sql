-- A website job — a new version of somebody's existing site, or a site
-- inspired by one — is client work: someone else's before it is ours to show
-- (src/lib/register/client-work.ts). Previews made since that rule are created
-- with client_work = true (src/lib/previews/create.ts); jobs from before it
-- were left unmarked and so reached the public fleet map. Seen 2026-10-17: the
-- bitbaum chat offered strangers "derhochhinhousepartyrenner-ch-refresh-…",
-- described by its own build instruction.
--
-- Only rows nobody has answered (client_work IS NULL): an explicit answer,
-- either way, is the operator's and stands.
UPDATE user_projects SET client_work = true
WHERE client_work IS NULL
  AND (
    COALESCE(slug, name) ~ '-(refresh|inspired)-[0-9a-f]{32}$'
    OR name ~ '-(refresh|inspired)-[0-9a-f]{32}$'
    OR description ILIKE 'Develop a new version of this existing website%'
    OR description ILIKE 'New version of http%'
    OR description ILIKE 'Create a new, independent website inspired by%'
  );
