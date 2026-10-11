-- Migration: a thread Loki writes to, found again by name.
-- `updates:<projectKey>` is a project's progress channel: when a fix opens
-- its pull request, goes live or fails to deploy, Loki posts the update there
-- (lib/loki/updates-thread.ts) — the team-updating-the-manager thread. The
-- person may rename it; the channel is what identifies it. Null for every
-- ordinary conversation, so the unique index only constrains channels.
-- Hand-written, like 0073–0091.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_user_channel ON conversations (user_id, channel);
