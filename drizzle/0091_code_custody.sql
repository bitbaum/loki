-- Migration: who holds a project's code.
-- 'loki' = Loki created the repository in the fleet's organisation with the
-- server's own token and keeps it for the person; 'own' = the person's own
-- GitHub. Null rows predate custody and are treated as 'own', so no server
-- credential ever acts on a repository Loki did not create. Hand-written,
-- like 0073–0090.
ALTER TABLE user_projects ADD COLUMN IF NOT EXISTS code_custody text;
