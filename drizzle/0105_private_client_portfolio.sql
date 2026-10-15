-- Client work stays in the portfolio, behind the access code, until the client
-- agrees to be shown (src/lib/register/client-work.ts). Owner's answers, 2026-10-15.
-- Data only: UPDATEs, no schema change.

-- Sink Tattoo (Sammy): agreed to be shown publicly.
UPDATE user_projects
SET client_work = true,
    portfolio_consent_at = COALESCE(portfolio_consent_at, now()),
    portfolio_consent_note = COALESCE(portfolio_consent_note, 'Owner confirmed 2026-10-15: Sammy agreed to S-Ink being shown.')
WHERE lower(coalesce(slug, '')) IN ('s-ink', 'sink')
   OR lower(name) IN ('s-ink', 'sink', 's-ink tattoo', 'sink tattoo');
--> statement-breakpoint

-- Anushka (Wild Spirit Art), Farmacia del Parco, AOZ: client work, NOT agreed.
-- Shown only in the private area of bitbaum.orangecat.ch.
UPDATE user_projects
SET client_work = true,
    portfolio_consent_at = NULL,
    portfolio_consent_note = NULL
WHERE lower(coalesce(slug, '')) IN ('wild-spirit', 'annushka', 'farmaciadelparco', 'aoz', 'aoz-begleitung', 'aoz-wohnen', 'aoz-housing')
   OR lower(name) LIKE '%wild spirit%'
   OR lower(name) LIKE '%annushka%'
   OR lower(name) LIKE '%farmacia%'
   OR lower(name) LIKE 'aoz%';
--> statement-breakpoint

-- Vitareba was renamed Vita. Display text only: lowercase `vitareba` is an
-- infrastructure identifier (host, unit, database) and is left as it is.
UPDATE user_projects
SET name = replace(replace(replace(name, 'VitaReBa', 'Vita'), 'Vitareba', 'Vita'), 'VITAREBA', 'VITA'),
    description = replace(replace(replace(description, 'VitaReBa', 'Vita'), 'Vitareba', 'Vita'), 'VITAREBA', 'VITA')
WHERE name ~ '(VitaReBa|Vitareba|VITAREBA)' OR description ~ '(VitaReBa|Vitareba|VITAREBA)';
--> statement-breakpoint
UPDATE entities
SET name = replace(replace(replace(name, 'VitaReBa', 'Vita'), 'Vitareba', 'Vita'), 'VITAREBA', 'VITA'),
    description = replace(replace(replace(description, 'VitaReBa', 'Vita'), 'Vitareba', 'Vita'), 'VITAREBA', 'VITA')
WHERE name ~ '(VitaReBa|Vitareba|VITAREBA)' OR description ~ '(VitaReBa|Vitareba|VITAREBA)';
--> statement-breakpoint
UPDATE attributes
SET value = replace(replace(replace(value, 'VitaReBa', 'Vita'), 'Vitareba', 'Vita'), 'VITAREBA', 'VITA')
WHERE value ~ '(VitaReBa|Vitareba|VITAREBA)';
