-- Migration: user_preferences.standing_approvals — approval given once, not per item.
--
-- The approval queue was implemented as "nothing executes that the operator did
-- not TAP", which is a stricter rule than the one it was meant to enforce
-- ("nothing executes that the operator did not APPROVE"). For a calendar event
-- in the operator's own calendar — private, self-only, undone by deleting it —
-- the difference was pure latency: an event proposed at 14:15 on 2026-08-04 was
-- booked at 21:02, because approving it meant leaving the chat, signing in, and
-- finding the row. The gate protected nothing there.
--
-- This column stores the types the operator has approved IN ADVANCE. It is an
-- authorisation record, so it is read defensively: lib/actions/standing-approval.ts
-- filters it against a hard-coded eligible set on every read, and re-checks the
-- payload at decision time (an event with guests sends real invitations, so it
-- goes back to the queue whatever this column says). A row naming 'send_email'
-- therefore authorises nothing — widening the set is a reviewed code change,
-- never a database write.
--
-- DEFAULT '{create_event}': booking an appointment in your own calendar is not
-- a decision worth interrupting someone for, and every auto-approval is audited
-- and announced on Telegram. Everything that reaches other people stays off.
--
-- Additive, with a default; every existing row keeps working and gains the
-- calendar rule. Toggled per user at /approvals.

ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "standing_approvals" text[] NOT NULL DEFAULT '{create_event}';
