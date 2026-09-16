# Robots tab (foundation)

## Goal
Manage physical robots from Loki — start with **Cato’s two robot vacuum cleaners**. Foundation must not block later: bookable humanoids, sell/rent, fleet ops. May split to a robots-only product later; design boundaries clean now.

## v1 scope
- Robots tab listing devices Cato owns (seed/register 2 vacuums — names/ids from Cato when implementing; placeholders ok until hardware IDs exist).  
- Per robot: name, type (vacuum), online/offline/unknown, last interaction, simple actions if API exists (start/stop/dock) else “Status only — connector next.”  
- No fake humanoid marketplace in v1 — a clear “Coming: bookable humanoids” empty state is enough.

## Data model (sketch)
`robots` (id, owner_user_id, kind, display_name, external_id, status, last_seen_at, meta jsonb).  
Connectors later (vendor APIs). Do not hardcode vendor UI in five places — one robot card component.

## Nav
Top-level **Robots** next to **AI**. Same chrome as rest of app.

## Done when
Walk: Robots tab shows two vacuums with honest status; adding a third is data not a redesign. Schema migration + empty humanoid note. PR on bitbaum/loki.
