-- evig was rebranded from Revamp-IT on 2026-07-24 (evig CLAUDE.md, Layer A:
-- the user-facing brand is evig). Its public "solution" line still named
-- Revamp-IT, and the fleet map publishes it on bitbaum.orangecat.ch. Only
-- that one sentence opening; revamp-info, which IS about Revamp-IT the
-- organisation, is untouched.
UPDATE attributes
SET value = 'evig' || substring(value FROM length('Revamp-IT') + 1)
WHERE key = 'solution'
  AND value LIKE 'Revamp-IT provides refurbished technology%';
