-- Migration: client work is never public without the client's consent.
-- client_work: null = decided by the hosting register (apps.conf kind/owner),
-- true/false = the operator's explicit answer. portfolio_consent_at/_note: the
-- client agreed to be shown publicly, and how. Hand-written, like 0073–0096.
ALTER TABLE user_projects ADD COLUMN IF NOT EXISTS client_work boolean;
ALTER TABLE user_projects ADD COLUMN IF NOT EXISTS portfolio_consent_at timestamp with time zone;
ALTER TABLE user_projects ADD COLUMN IF NOT EXISTS portfolio_consent_note text;
