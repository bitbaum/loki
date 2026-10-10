-- Migration: a person's own endpoint as a model provider. `base_url` is the
-- OpenAI-compatible host for vendor = 'custom' (Ollama or LM Studio behind a
-- tunnel, a company gateway), checked by lib/models/endpoint-guard.ts before
-- it is stored and again at every connection; `label` is the name they gave
-- it. Both null for every other vendor, whose host is config, not data.
-- Hand-written, like 0073–0087.
ALTER TABLE user_model_keys ADD COLUMN IF NOT EXISTS base_url text;
ALTER TABLE user_model_keys ADD COLUMN IF NOT EXISTS label text;
