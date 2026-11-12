-- A project member may drive the project's own agent session on the owner's
-- builder only when the owner says so (src/lib/session-drive.ts): one column,
-- off by default.
--
-- Then the one grant asked for (QA seat walk, 2026-11-12): the memberships on
-- the default (owner) account's qa-agent-walk project, so QA's seat can drive
-- that project's session and nothing else. Every other membership stays off;
-- the owner grants or takes it back with PATCH /api/projects/<id>/members.

ALTER TABLE "project_memberships" ADD COLUMN "drives_session" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE project_memberships pm
SET drives_session = true, updated_at = now()
FROM entities e
WHERE pm.project_id = e.id
  AND e.type = 'project'
  AND lower(e.name) = 'qa-agent-walk'
  AND e.user_id IN (SELECT id FROM users WHERE is_default = true);
