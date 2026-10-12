-- Migration: pictures people put into a Loki chat, kept with the thread.
-- They used to reach the agent and vanish, leaving "[Attached: x.png (image)]"
-- in the message. Own table, not the message row: a thread is read whole, so
-- the message carries only a path to the bytes. Deleted with the conversation.
-- Hand-written, like 0073–0095.
CREATE TABLE IF NOT EXISTS conversation_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  mime_type text NOT NULL,
  name text NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversation_images_conversation ON conversation_images (conversation_id);
