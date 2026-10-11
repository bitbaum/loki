-- Migration: the rail as an inbox.
-- last_read_at: when the person last had the thread open, so a reply, a run
-- outcome or a question that arrived after it can be shown as such instead
-- of looking like every other row. pinned_at: the few threads being juggled
-- today stay on top. Hand-written, like 0073–0094.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_read_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
