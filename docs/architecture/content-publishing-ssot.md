# Content publishing SSOT — studio blogs and Thoughts

**created_date:** 2026-08-20  
**last_modified_date:** 2026-09-30  
**last_modified_summary:** Phase E: the folder reader, markdown normalization and FAQ moved into bip-kit 0.5; six products read their content through it.

---

## Problem

Studio products each reinvented "markdown posts on the public site." That duplication is fine for voice; it is expensive for media affordances, theme tokens, frontmatter shape, and embed security.

## Decision

1. **`bip-kit` (npm)** is the shared parser + types: `parseContentBlocks`, video allowlist, roadmap/changelog shapes. Since 0.5 it also owns the folder reader (`readCollection` / `readEntry` from `bip-kit/node`), `normalizeMarkdown`, and questions and answers (`parseFaq` + `<Faq>`).
2. **Loki Thoughts** dogfoods the essay UX (React renderers, Mermaid, theme-aware public chrome).
3. **Theme SSOT** is `THEME_OPTIONS` + `ThemeProvider` + CSS tokens. Public surfaces must not pin `.dark`.

Programme: [building-in-public-ssot.md](./building-in-public-ssot.md).

## Contract (block types)

Authors write ordinary markdown. The parser emits:

- Headings, lists, blockquotes, paragraphs (inline bold/italic/code/links)
- Fenced code (including Mermaid → client Mermaid in FC)
- GFM tables
- Images
- Embeds: lone YouTube or Vimeo URL on its own line

Style voice: `docs/thoughts-style-guide.md`.

## Phased centralization

| Phase | Work | Done when |
|-------|------|-----------|
| **A** | Loki media + public theme | Done |
| **B** | Docs | Done |
| **C** | Second consumer (AOZ) on `bip-kit` | AOZ package.json + tests |
| **D** | OSS | Done — github.com/bitbaum/bip-kit |
| **E** | One folder reader, one normalizer, one FAQ (bip-kit 0.5) | Done 2026-09-30 — see below |

### Who reads content through bip-kit 0.5

| Product | Folders | Local rule kept on top |
|---------|---------|------------------------|
| Loki | `content/thoughts/`, `content/whitepaper.md` | Thoughts vocabulary (`subtitle`, `featured`, `readingTimeMin`) |
| Solon | `content/blog/`, `content/whitepaper.md`, `content/faq.md` | none |
| OrangeCat | `content/blog/`, `content/faq.md` | FAQ `{{placeholders}}` from `cat-plans.ts` |
| Botsmann | `content/blog/`, `content/knowledge/**` | only `published: true` ships |
| Substrata | `content/notes/`, `content/learn/` | title, summary, publishedAt, author required |
| AOZ Begleitung | `docs/blog/` | dated file names and `# h1` titles required |

A fix to the reader or normalizer now reaches all six with a version bump.

## What not to centralize

- Product voice and brand-specific frontmatter
- CMS / DB-backed UGC (OrangeCat feature blogs)
- Site chrome — tokens yes; layout no

## Related

- [building-in-public-ssot.md](./building-in-public-ssot.md)
- `bip-kit` on npm
- `src/lib/thoughts-content.ts` — Thoughts FS loader
- `src/components/thoughts/*` — Mermaid, video embed UI
- `src/components/shell/ThemeToggle.tsx` — `THEME_OPTIONS`
