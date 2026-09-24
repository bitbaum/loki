-- Migration: site_feedback.intent — what the reporter wants done.
--
-- WHY THIS EXISTS
-- The widget was a bug form, and every row meant "fix this". But what people
-- mostly mean when they point at part of someone else's product is "I don't
-- like how this works for me", and that has two different answers: change it
-- (build), or show me the way to what I want — it may already exist (guide).
-- The agent prompt differs (src/lib/feedback/compose-dispatch.ts), so the row
-- has to remember which one was asked.
--
-- NULL = build: every row filed before the widget asked meant exactly that, so
-- no backfill is needed. Values are checked at the ingest boundary (zod,
-- FEEDBACK_INTENT_VALUES), not in a CHECK constraint.
ALTER TABLE site_feedback
  ADD COLUMN IF NOT EXISTS intent text;
