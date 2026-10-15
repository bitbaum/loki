-- The light/dark choice made in Loki, kept on the account so the widget on the
-- owner's own site can show in the same mode (widget/theme-mode.ts).
ALTER TABLE "user_preferences" ADD COLUMN "theme" text;
