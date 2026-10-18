-- Diplodoctor, as its own repository describes it.
--
-- Found 2026-10-18: diplodoctor.orangecat.ch has been running since
-- 2026-09-10 (health: db up, AI on, text and photo analysis on), but Loki's
-- project row had no repository link — so Loki never read its README,
-- ROADMAP.md or CHANGELOG.md — and its public identity still described the
-- first idea: cross-border healthcare and medical tourism. The README says
-- Loki holds that identity and bitbaum.orangecat.ch renders it, so the
-- correction belongs here. Texts below are taken from the README
-- (github.com/bitbaum/diplodoctor), not invented.
--
-- The replaced values, kept so nothing is lost:
--   problem:  Patients struggle to manage personal health records across
--             borders and navigate complex legal restrictions or availability
--             of specialized treatments.
--   solution: Offers an AI clinical companion that analyzes patient records to
--             flag treatment options and legal hurdles, validated by licensed
--             doctors via a telemedicine marketplace.
--   mission:  To provide accessible, transparent, and legally compliant
--             cross-border healthcare by pairing AI clinical reasoning with
--             licensed medical oversight.
--   vision:   A seamless global healthcare and medical tourism ecosystem where
--             patients access compliant cross-border treatments and
--             diagnostics backed by verified clinicians.
--
-- Data only: no schema change. A row already linked to a repository keeps it.

UPDATE user_projects
SET git_url = 'https://github.com/bitbaum/diplodoctor', updated_at = now()
WHERE coalesce(git_url, '') = ''
  AND (lower(coalesce(slug, '')) = 'diplodoctor' OR lower(name) = 'diplodoctor');
--> statement-breakpoint
UPDATE entities
SET git_url = 'https://github.com/bitbaum/diplodoctor'
WHERE coalesce(git_url, '') = ''
  AND id IN (
    SELECT entity_project_id FROM user_projects
    WHERE lower(coalesce(slug, '')) = 'diplodoctor' OR lower(name) = 'diplodoctor'
  );
--> statement-breakpoint
UPDATE attributes AS a
SET value = v.value, source = 'readme-2026-10-18'
FROM (VALUES
  ('problem', 'A lab report reaches the person it is about as a page of values, units and printed ranges that they usually cannot read on their own.'),
  ('solution', 'Paste or photograph a lab report and see every value, which ones are outside their printed range, what they measure and what to ask your doctor, without an account and in five languages. The AI reads and explains but never diagnoses or prescribes; health assistants anyone can be, and licensed professionals where the law reserves the work, help with the rest.'),
  ('mission', 'Help anyone understand their own medical results, with the person deciding what leaves them and who helps.'),
  ('vision', 'Three kinds of help in one place: any AI model, health assistants, and licensed professionals who can prove their licence without revealing who they are, each saying only what they are allowed to say.')
) AS v(key, value)
WHERE a.key = v.key
  AND a.entity_id IN (
    SELECT entity_project_id FROM user_projects
    WHERE lower(coalesce(slug, '')) = 'diplodoctor' OR lower(name) = 'diplodoctor'
  );
