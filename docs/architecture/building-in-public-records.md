# Building-in-public records — the repository file contract

**created_date:** 2026-09-28  
**last_modified_date:** 2026-09-28  
**last_modified_summary:** First version: ROADMAP.md / CHANGELOG.md contract, map ingestion, per-site rendering rule, the scale roadmap placement.

## Why this exists

The fleet's canonical roadmap/changelog is Loki's fleet map
(`https://loki.orangecat.ch/api/fleet/map`, consumed via npm `bip-kit`
`loadDevelopmentProfile(mapUrl, slug)` / `DevelopmentPage`). Audited today
(2026-09-28): the only producers were Loki's `goals` table and `dev_log`
column. 19 of 34 projects had goals, nearly all of them one machine-seeded
placeholder ("Make <x> development and verification public", 0 of 3 steps
done); the changelogs were dev-log run notes. Meanwhile Loki, OrangeCat, Heidi and evig each keep a local copy of their
roadmap/changelog (which `docs/architecture/building-in-public-ssot.md` says
never to do), and Solon / Petvity have no pages at all.

Fix: the record lives IN EACH PUBLIC REPO as two markdown files, and Loki's
map ingests them (`src/lib/register/repo-records.ts`). Where a file exists it
is the record; goals and the dev log remain the record for projects without
one. Every product renders its
`/roadmap` and `/changelog` from the map through bip-kit. The repo is the SSOT,
the map is the producer, the sites are consumers.

## `ROADMAP.md` (repo root)

```md
# Roadmap

One or two sentences of lede (optional, ignored by the parser).

## Now
### <Item title>
One line saying what this is and why. (optional)
Target: 2026-Q4            ← optional; any text after "Target:" becomes targetDate
- [x] A milestone that is done
- [ ] A milestone that is not

## Next
### <Item title>
...

## Later
### ...

## Shipped
### ...
```

Rules the parser applies:
- `##` headings are buckets. Status is derived from the bucket title
  (case-insensitive): `now`/`in progress`/`doing` → `in progress`;
  `next`/`planned`/`soon` → `planned`; `later`/`someday`/`future` → `later`;
  `shipped`/`done`/`delivered` → `done`. Any other bucket title is used verbatim
  (lowercased) as the status.
- `###` headings are roadmap items. Everything until the next `###`/`##` belongs
  to that item.
- `- [x]` / `- [ ]` lines are milestones (done / not done).
- Progress = round(done / total × 100) when the item has milestones, else null;
  items in a `done` bucket read 100.
- A `Target:` line sets targetDate (kept verbatim, e.g. `2026-Q4` or `2026-11`).
- No dates are required. Order carries the argument (Heidi's rule).
- Nothing here may claim what is not true. Planned things are written as plans.

## `CHANGELOG.md` (repo root) — Keep-a-Changelog dialect

```md
# Changelog

Optional intro prose.

## 2026-09-28
### Added
- **Short title.** One or two sentences in the words of someone using it.
### Fixed
- **What was wrong.** What it does now.

## [0.4.0] - 2026-09-20      ← version form also accepted; the date is what matters
- Bullet without a section is fine too.
```

Rules:
- A `##` heading containing an ISO date (`YYYY-MM-DD`) starts an entry; text
  before the first dated heading is ignored.
- All bullet lines under it (any `###` sub-sections) become the entry's `done`
  text: bullets joined with newlines, markdown emphasis stripped, `**Title.**`
  kept as plain text. Sub-bullets are dropped. Cap ~700 chars per entry.
- Newest first in the file (the map re-sorts anyway).
- User-facing: what a reader can now do / what was wrong, never commit slang.
  Fixes get the same weight as features. Numbers are the ones in the commits.

## What each site's `/roadmap` and `/changelog` page does

```tsx
import { loadDevelopmentProfile } from "bip-kit";
import { DevelopmentPage } from "bip-kit/react";
import "bip-kit/styles.css";

const FLEET_MAP = "https://loki.orangecat.ch/api/fleet/map";
const profile = await loadDevelopmentProfile(FLEET_MAP, "<slug>"); // null when unavailable
return <DevelopmentPage profile={profile} section="roadmap" homeHref="/" profileHref="https://loki.orangecat.ch/fleet/<slug>" />;
```

- Fetch with `next: { revalidate: 300 }` semantics (the map is cached 5 min);
  `loadDevelopmentProfile` accepts a `fetcher` — pass one that sets revalidate.
- Wrap in the site's own shell/chrome; override `--bp-*` CSS variables to the
  site's tokens (bip-kit/styles.css is neutral and themeable). Never hardcode
  hex. Sites with a strong house style may render `profile.roadmap` /
  `profile.changelog` themselves (Substrata does) — the DATA must come from the
  map, the markup may be the site's.
- `null` profile → the page says records are temporarily unavailable (the
  renderer does this). Empty arrays → "nothing recorded yet".
- Delete any local roadmap/changelog config copy the page used to read, and
  move its content into ROADMAP.md / CHANGELOG.md so nothing is lost.
- Link both pages from wherever the site links its blog / footer.

Slugs in the map: loki, orangecat, solon, evig, heidi, petvity, substrata.

## Which product carries what (the scale roadmap, 2026-09-28)

The platform walls, in the order they are hit, live in Loki's ROADMAP.md
("Capacity you can read" holds the trigger metrics): tenancy on the box; one
box becomes a pool; bring your own key, metered; the partner track; Loki as a
GitHub App; own inference for routine work; the academy. OrangeCat carries the
economic half (partner payouts and client funding, the metered Cat Credits
pool); Solon carries the governance half (partner approval and revenue-share
rules as signed votes). The essay: https://orangecat.ch/blog/where-the-wall-is.

## Who complies (2026-09-28)

| Site | ROADMAP.md / CHANGELOG.md | /roadmap and /changelog read the map |
| --- | --- | --- |
| loki | yes | yes, in-process (`src/lib/register/own-record.ts`) |
| orangecat | yes | yes |
| solon | yes | yes (`DevelopmentPage`) |
| petvity | yes | yes (`DevelopmentPage`) |
| evig | yes | roadmap yes; changelog keeps its version-rail UI, CHANGELOG.md mirrors its config |
| substrata | yes | yes (own markup) |
| heidi | yes (EN, mirrored from its bilingual config by a test) | no — deliberately local bilingual docs, typed by bip-kit; see the comment in `lib/config/roadmap.ts` |
