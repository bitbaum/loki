-- Migration: project_invitations — invite someone into ONE project by email,
-- whether or not they have an account yet.
--
-- WHY THIS EXISTS
-- Adding a collaborator required an existing Loki account; the route answered
-- "No Loki account uses that email. Ask them to register first." — a dead end
-- that left the owner to explain sign-up out of band. The only other invite
-- path (the `invitations` table) creates a LOCAL-PASSWORD account and drops it
-- into the inviter's whole org: broader than one project, and a second identity
-- path beside OrangeCat, which fleet STACK.md says our own products must not
-- grow.
--
-- This grants exactly `role` on exactly `project_id`, to whoever signs in with
-- `email`. The person arrives through OrangeCat sign-in; nothing here stores a
-- password.
--
-- ONLY A HASH OF THE TOKEN IS STORED (sha-256, hex). The raw token exists in
-- the link and nowhere else, so a leaked backup cannot be replayed as a set of
-- working invite links. (The older `invitations` table stores tokens in plain
-- text; not copied here.)
--
-- Hand-written, like 0073–0079: drizzle/meta's snapshot stops at 0072, so
-- `drizzle-kit generate` currently diffs against a stale picture — it believes
-- beacon_sessions still exists and calendar_busy does not, and would emit a
-- DROP and a duplicate CREATE alongside this table.
CREATE TABLE IF NOT EXISTS project_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_invitations_project
  ON project_invitations (project_id);
CREATE INDEX IF NOT EXISTS idx_project_invitations_email
  ON project_invitations (email);
