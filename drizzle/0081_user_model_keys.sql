-- Migration: user_model_keys — the model a user brings to power Loki.
--
-- WHY THIS EXISTS
-- Loki's own chat ran only on the shared, rationed free chain: when the day's
-- budget ran out a user was told to wait, and there was no way to say "use my
-- Anthropic / OpenAI / OpenRouter / … key instead". This stores that choice:
-- a vendor from ai-kit's closed list, the model picked there, and the key.
--
-- THE KEY IS STORED SEALED (ai-kit/seal: AES-256-GCM, scrypt-derived from the
-- app's BYOK_SEAL_SECRET, `iv:tag:ciphertext`). The database alone cannot read
-- it, no API ever returns it, and `key_hint` ("…abcd") is the only part shown.
-- One row per user; removing the user removes the key.
--
-- Hand-written, like 0073–0080: drizzle/meta's snapshot stops at 0072, so
-- `drizzle-kit generate` diffs against a stale picture and asks whether this
-- table is a rename of beacon_sessions.
CREATE TABLE IF NOT EXISTS user_model_keys (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vendor text NOT NULL,
  model text NOT NULL,
  sealed_key text NOT NULL,
  key_hint text NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
