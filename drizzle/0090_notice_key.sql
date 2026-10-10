-- Migration: what Loki noticed while watching, as a key the fix remembers.
-- Watch's remark signature (widget/watch-trail.ts) travels with "Fix this"
-- and is stored here, so the same finding on the next visit finds its fix —
-- in flight, live, or closed — instead of filing a second one. Null for every
-- row that did not start as a Watch remark. Hand-written, like 0073–0089.
ALTER TABLE site_feedback ADD COLUMN IF NOT EXISTS notice_key text;
CREATE INDEX IF NOT EXISTS idx_site_feedback_notice ON site_feedback (project_id, notice_key);
