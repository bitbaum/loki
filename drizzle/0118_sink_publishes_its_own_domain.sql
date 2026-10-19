-- Sink is published at its own domain.
--
-- Found 2026-10-19 by the fleet's live-claims audit (bitbaum/fleet
-- scripts/ci/live-claims-audit.mjs): https://orangecat.ch/ecosystem renders
-- this register's project descriptions, and one still said
-- "Live work: … sink.orangecat.ch". bitbaum/fleet registers/retired.json
-- retired that host on 2026-08-20 in favour of sinktattoo.com, the client's
-- own domain; the subdomain survives only as a legacy redirect. The owner
-- confirmed sinktattoo.com on 2026-10-19.
--
-- Data only: no schema change. Only the host is replaced; every other word of
-- each description is kept as written.

UPDATE user_projects
SET description = replace(description, 'sink.orangecat.ch', 'sinktattoo.com'), updated_at = now()
WHERE description LIKE '%sink.orangecat.ch%';
