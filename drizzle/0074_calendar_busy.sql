-- Migration: calendar_busy — a read-only mirror of the operator's calendar.
--
-- WHY THIS EXISTS
-- The calendar lives behind `gog`, which is authenticated only on the operator's
-- own machine. The cloud control plane — where proposals are made, cards are
-- sent and decisions are taken — cannot see it at all (api/calendar/route.ts
-- returns `runtimeOnly: true` there). So an approval card could say "Dentist,
-- Thu 14:30" while Thu 14:30 was already spoken for, and did: a test booking on
-- 2026-09-17 landed on top of an existing 15:00 meeting and nothing said a word.
--
-- This is the smallest thing that fixes it: the box pushes a rolling window of
-- BUSY BLOCKS (what is occupied, and what it is called), and the cloud reads it
-- to warn before you approve. It is a cache, never a source of truth — Google
-- remains authoritative and `gog` remains the only writer.
--
-- REPLACE-THE-WINDOW, NOT MERGE. A sync deletes the rows it covers and inserts
-- what it was given. Merging would be wrong in the one direction that matters:
-- an event DELETED in Google would linger here forever and produce a phantom
-- conflict, and a warning that cries wolf is worse than no warning at all.
--
-- `synced_at` is load-bearing. If the box is offline the mirror goes stale, and
-- stale-and-empty is indistinguishable from genuinely-free unless the reader can
-- tell how old it is. Consumers must say "could not check" rather than imply a
-- clear diary (lib/calendar/busy.ts).
--
-- Deliberately minimal: no attendees, no description, no location. This answers
-- "is this slot taken, and by what" and nothing else — the less of the
-- operator's calendar is copied off their machine, the better.

CREATE TABLE IF NOT EXISTS "calendar_busy" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_id" text NOT NULL,
  "summary" text,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "all_day" boolean NOT NULL DEFAULT false,
  "synced_at" timestamptz NOT NULL DEFAULT now()
);

-- The overlap query is always "this user, in this time range".
CREATE INDEX IF NOT EXISTS "idx_calendar_busy_user_window"
  ON "calendar_busy" ("user_id", "starts_at", "ends_at");

-- One row per Google event per user. A re-sync of the same window replaces
-- rather than duplicates, even if the delete half were ever to fail.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_calendar_busy_user_event"
  ON "calendar_busy" ("user_id", "event_id");
