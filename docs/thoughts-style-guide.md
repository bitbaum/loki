# Thoughts — style skill (SSOT for the voice)

**created_date:** 2026-05-18  
**last_modified_date:** 2026-10-09  
**last_modified_summary:** Anyone-first prose with `deep` (closed `<details>`) sections for the technical depth; the fence is rendered by components/thoughts/DeepBlock.tsx and by OrangeCat's lib/longform/DeepBlock.tsx.

This is the **skill** any agent (or human) reads before writing a Loki
Thoughts essay. It makes the house voice explicit and reusable instead of
re-derived each time. A per-user **writing voice** preference (Settings) layers
on top to shift tone; this file is the default everything starts from.

Studio-wide publishing contract (other apps' blogs, OSS kit):
`docs/architecture/building-in-public-ssot.md` · npm package **`bip-kit`**.

## Voice
- **Declarative and systems-first.** State the mechanism, then the consequence. "X is true, therefore Y." Not "maybe", "perhaps", "it could be argued."
- **One sharp metaphor, earned.** A single concrete image that carries the idea ("the captain needs a ship"; "a prompt is one throw of the dice, a harness is the table"). Never a parade of them.
- **Concrete over abstract.** Name the file, the number, the real event. Cite what actually happened (the 21 invisible projects; the cross-model gate scoring 80). Evidence, not adjectives.
- **No hype, no hedging.** No "revolutionary", "game-changing", "supercharge". Also no nervous qualifiers. Confidence earned by specifics.
- **Honest about limits.** Name the gap, the unbuilt phase, the weakest strut. Credibility comes from saying what doesn't work yet.
- **Short paragraphs. Strong first sentences.** Each section's opener can stand alone as the claim.

## Shape
- **Anyone first, depth on request.** The prose is written so a reader with no technical background follows it start to end and finds it interesting. The parts that name files, functions, regexes and numbers go into `deep` sections (below) the reader opens on purpose. Stated by the operator 2026-10-09: "easy and interesting to read to anyone, regardless of whether they're technical or not, but with sections that are extremely technical that people can reveal."
- Lead with the tension or the finding, not background.
- Build: mechanism → why it matters → what we do about it.
- End on a single crisp line that compresses the essay.
- **Show structure.** At least one non-prose block when the essay compares systems, lists seams, or describes a pipeline: GFM table, Mermaid diagram, or committed SVG under `public/thoughts/`. Text-only essays are a failure mode, not the house look.

## Media (supported markdown)

| Affordance | How to write it |
|------------|-----------------|
| **Table** | GFM: header row, `| --- |` separator, then rows. Use for market maps, surface→need, claim→file. |
| **Diagram** | Fenced ` ```mermaid ` … ` ``` ` (flowcharts, sequence, state). Follows Light/Dark/Auto. |
| **SVG / photo** | `![Caption](/thoughts/your-file.svg)` — local SVG inlined so strokes use CSS tokens. Raster/remote via the same syntax. |
| **Video** | Put a lone YouTube or Vimeo URL on its own line (no markdown link wrapping). Other hosts stay links, not iframes. |
| **Deep section** | Fenced ` ```deep Under the hood: <topic> ` … ` ``` ` — any markdown inside, rendered as a closed `<details>`. The essay reads whole without opening one; the files, regexes and numbers live inside. |

Do not paste random third-party iframes or unallowlisted players. Prefer repo-owned diagrams over stock collage.

## Frontmatter (required)
```
---
title: <Title Case, evocative not clickbait>
summary: <1–2 sentences, what + why it matters>
excerpt: <one quotable line — often the central metaphor>
publishedAt: <YYYY-MM-DD>
tags: <comma,separated,lowercase>
featured: <true|false>
author: Loki
readingTimeMin: <integer>
---
```

## Public chrome
Thoughts uses the same theme control as the signed-in app (`THEME_OPTIONS`: Light / Dark / Auto). Do not assume always-dark marketing chrome when writing or screenshotting.

## Don'ts
- No marketing-speak, no emoji in prose, no exclamation marks.
- Don't restate the title in the first line.
- Don't reproduce the founder's real name — pseudonymous only where the essay requires a persona.
- Don't fabricate timelines or metrics; if you didn't verify it, don't claim it.
- Don't ship a comparison essay without a table or diagram.

## Examples in this voice
`the-captain-needs-a-ship.md`, `the-harness-not-the-prompt.md`,
`a-valid-id-is-a-claim-not-a-fact.md`,
`connected-not-joined-author-replies-to-muskrat.md` (tables + seam diagram).
