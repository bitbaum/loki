# Building in Public kit — studio SSOT

**created_date:** 2026-08-20  
**last_modified_date:** 2026-09-28  
**last_modified_summary:** Roadmap and changelog are repository files read into the fleet map; every site renders the map. See building-in-public-records.md.

---

## Thesis

Every public product in the studio ships **three surfaces**:

| Surface | Job | Audience |
|---------|-----|----------|
| **Blog / Thoughts** | Why and how (essays, evidence, diagrams) | Builders, users, search |
| **Roadmap** | Where we are going (honest not-yet) | Same |
| **Changelog / Releases** | What shipped (user-facing, dated) | Same |

That triad is **building in public**. Quality must be tremendous: theme SSOT, media when structure demands it, no claims that contradict the code.

The reusable kit is **[`bip-kit`](https://github.com/bitbaum/bip-kit)** on npm — parser + types. Bring your own design system. Dogfood: Loki Thoughts (flagship), AOZ Wohnen (second consumer).

## Company voice vs user publishing

| | Company / product BiP | Blog as a feature (UGC) |
|--|----------------------|-------------------------|
| **Who** | Studio / product owner | Actors / end users |
| **Where** | Product domain (`/thoughts`, `/blog`, …) | **OrangeCat** only |
| **Loki** | Thoughts + Roadmap + Releases | **Never** a user Medium |
| **Trust** | Official shipping truth | Social reputation |

## Content contract

Long-form markdown uses blocks from `bip-kit` (`parseContentBlocks`): headings, lists, quotes, paragraphs, GFM tables, Mermaid fences, images, allowlisted YouTube/Vimeo embeds.

Roadmap and changelog are records: `ROADMAP.md` and `CHANGELOG.md` at the repository root, read into the fleet map (`/api/fleet/map`) and rendered on every site through `bip-kit`'s `loadDevelopmentProfile` / `DevelopmentPage` (or the site's own markup over the same data). Never a local copy in a config file. Contract and audit: [building-in-public-records.md](./building-in-public-records.md).

## Status

| Phase | Work | Status |
|-------|------|--------|
| **1a** | Loki Thoughts media + public theme | Done |
| **1b** | Document triad + company/UGC | Done |
| **1c** | Extract + publish `bip-kit`; FC depends on npm | Done |
| **1d** | Second studio consumer (AOZ) on `bip-kit` | In progress |
| **2** | Public GitHub + npm | Done — https://github.com/bitbaum/bip-kit |
| **3** | Roadmap + changelog as repository records on every site, via the fleet map | Done 2026-09-28 (Heidi keeps deliberate bilingual local docs; evig keeps its changelog UI) |
| **3** | Roadmap + changelog as repository records on every site, via the fleet map | Done 2026-09-28 (Heidi keeps deliberate bilingual local docs; evig keeps its changelog UI) |

## Funnel

Studio sites look excellent → `bip-kit` stars/PRs → hosted upgrade via OrangeCat site factory / Loki.

## Related

- [content-publishing-ssot.md](./content-publishing-ssot.md)
- [building-in-public-records.md](./building-in-public-records.md) — the file contract and who complies
- Publishing procedure (voice, frontmatter, checks, shipping): `orangecat/.claude/skills/publish-article/SKILL.md`
- Publishing procedure (voice, frontmatter, checks, shipping): 
- `docs/thoughts-style-guide.md`
- npm: `bip-kit`
- FC: `src/lib/thoughts-content.ts` (re-exports), `scripts/test/bip-seam.ts`
