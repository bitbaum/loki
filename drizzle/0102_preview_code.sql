-- Migration: the operator's own access code for prospect previews
-- (src/lib/previews/access.ts, src/db/queries/preview-code.ts).
-- Additive: one nullable column. Null = use LOKI_PREVIEW_CODE from the env.
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "preview_code" text;
