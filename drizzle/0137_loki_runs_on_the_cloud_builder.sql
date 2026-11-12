-- Loki's own project runs on the cloud builder.
--
-- Found 2026-11-12 by a production probe: the registration made on the
-- owner's laptop (dir_path /home/g/dev/loki) was still pinned to
-- builder_pref 'local'. That laptop has been offline since 2026-11-11 07:19,
-- so every dispatch to loki asked for an offline builder and was sent on to
-- the cloud builder. The project has a GitHub repository and the cloud builder
-- has its own checkout, so the stored answer should be the builder that runs
-- it. The owner's supervisor asked for the move on 2026-11-12.
--
-- Data only: no schema change. Only that one registration is touched: the
-- laptop path identifies it, so another account's project called "loki" is
-- left alone. The owner can set it back in the project's profile.

UPDATE user_projects
SET builder_pref = 'cloud', updated_at = now()
WHERE lower(name) = 'loki'
  AND builder_pref = 'local'
  AND dir_path = '/home/g/dev/loki';
--> statement-breakpoint

-- The same project's session note still said the session was blocked on a
-- usage limit of the agent it ran with on the laptop. That session is gone
-- with the laptop; the note described a machine that is no longer running the
-- project. Cleared only while it still says so, so a newer note written by
-- the cloud builder's session is never touched.

UPDATE project_states ps
SET session_status = NULL,
    session_done = NULL,
    session_next = NULL,
    session_todos = NULL,
    session_health = NULL,
    session_block_reason = NULL,
    updated_at = now()
FROM user_projects up
WHERE up.user_id = ps.user_id
  AND lower(up.name) = 'loki'
  AND up.dir_path = '/home/g/dev/loki'
  AND lower(ps.project_key) = 'loki'
  AND concat_ws(' ', ps.session_done, ps.session_next, ps.session_todos, ps.session_health)
      ILIKE '%usage limit%';
