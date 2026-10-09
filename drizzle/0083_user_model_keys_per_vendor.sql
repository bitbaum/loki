-- Migration: user_model_keys — several keys per user, one per vendor.
--
-- WHY THIS EXISTS
-- The table held ONE key per user, so "add a key for the model that is not
-- available here" meant "replace the key you had". A person now holds one key
-- per vendor and orders them into their own chain (`position`, 0 first): Loki
-- thinks with the first and falls through to the rest when a vendor is busy or
-- out of credit — the same walk the free chain does, on the user's accounts.
--
-- Existing rows keep user_id + vendor and become position 0. Nothing is
-- re-sealed; the key column is untouched.
--
-- Hand-written, like 0073–0082: drizzle/meta's snapshot is stale for this
-- table, so `drizzle-kit generate` would not diff it correctly.
ALTER TABLE user_model_keys ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE user_model_keys DROP CONSTRAINT IF EXISTS user_model_keys_pkey;
ALTER TABLE user_model_keys ADD CONSTRAINT user_model_keys_pkey PRIMARY KEY (user_id, vendor);
