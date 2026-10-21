# Design reset — October 2026

The owner, 2026-10-21, after walking the app on his phone: "very obviously
malfunctioning … poorly designed … people can't use it, I can't use it." He
pointed at the apps he does use every day — Claude, ChatGPT, Grok — and at
OrangeCat's own Cat page. This file is the bar every page is held to, written
so an agent with no context can apply it and a reviewer can check it.

It does not replace the four-layer system in `CLAUDE.md` (tokens → theme →
`ui-*` classes → JSX). It says what to BUILD with it.

## What the references do, and Loki did not

| The references (Claude, ChatGPT, Grok, OrangeCat Cat) | Loki on 2026-10-21 |
|---|---|
| One surface. Content sits on the page, not in boxes. | Boxes in boxes; every section a bordered card. |
| A list is rows: avatar or icon, a name, one grey line, a date on the right. | Rows carry 4–6 badges, counts and coloured words each. |
| Headings are plain sentence case. | `LETTER-SPACED CAPS` section labels everywhere. |
| No sentence explains the page. | A grey sentence under nearly every heading. |
| One obvious action, in the same place on every page. | 1–4 primary-looking buttons per screen, in different places. |
| Nothing sticks except the top bar and the box you type in. | A 154 px sticky filter block on Projects; a floating tab over every page's right edge. |
| Choices fit the screen or are clearly a menu. | Chip rows and stat pills cut off mid-word at the right edge. |
| Words a person would say. | "8 of 10 checks", "Global auto-continue", "Dispatch failed — no running agent for … on this runner". |

## The rules

1. **One title per page.** On a phone the top bar names the page; the page
   does not repeat it. Exactly one `<h1>` in the DOM at every width.
2. **No explanation line under a title.** If a page needs explaining, the
   empty state explains it, once, and disappears when there is content.
   Help that matters in use goes on the control it is about.
3. **Rows, not cards.** A collection is a list of rows (`ListRow`): leading
   icon/avatar, title, ONE secondary line, at most one trailing fact (time,
   count, chevron). Status is a word or a small dot in the secondary line,
   never a third line of badges. Cards are for a single distinct object (a run
   in progress, a dialog); never nest one card in another.
4. **Sentence-case section headings.** `SectionHeading`: normal weight
   contrast, no tracking, no uppercase. The `ui-kicker`/`ui-micro-label`
   caps style is for nothing larger than a tag.
5. **One primary action per page, in the top bar.** A round `+` (or the one
   verb the page is for) at the top right of the page header — the place
   Claude puts "new chat". Secondary actions go in the row's own menu (`…`)
   or in the page's overflow menu. Never two black buttons side by side.
6. **Nothing sticky but the top bar, the bottom bar and a composer.** Filters
   scroll away with the page. If a list needs search, the search is the first
   row of the list, not a pinned block.
7. **Fit or menu.** A row of choices fits the phone width (`<Segmented>`) or is
   a single button that opens a sheet ("Sort: Priority ▾"). A horizontally
   scrolling chip row is allowed only for filters, must show that it scrolls,
   and must never cut a word at the edge. Stats are a sentence ("2 goals,
   48% done"), not a scrolling row of pills.
8. **Colour means state, and only when acting on it helps.** Red: broken,
   needs you now. Amber: needs you soon. Everything else — "not connected",
   "paused", "draft" — is grey text. No orange words as decoration.
9. **Say it the way a person would.** No internal names (`runner`, `dispatch`,
   `tab`, `adapter`, `cron`, `checks`), no raw errors, no URLs as content, no
   folder slugs as names (`projectTitle()` everywhere). An error is one
   sentence and the button that fixes it.
10. **Empty is quiet.** An empty state is an icon, one line, and one button —
    no border, no box, no second paragraph.
11. **Stale is gone.** A notification or alert older than its relevance (a
    nudge from 28 days ago) resolves itself or folds into "Earlier". Counts
    (the bell's 9+) count only what still needs the person.
12. **Loki's own widget lives in the chrome.** On Loki's own pages the
    feedback launcher is a top-bar icon, not a tab floating over the content.

## Spacing and type (phone first)

- Page gutter 16 px (`px-4`); rows 56–72 px tall, 12–16 px vertical padding.
- Title in the top bar 17 px semibold. Section heading 15 px semibold,
  sentence case, 24 px above it, 8 px below.
- Row title 16 px medium; secondary line 14 px `text-text-secondary`, one
  line, ellipsis; trailing fact 13 px `text-text-tertiary`.
- Top-bar icon buttons: 40 px round, no border, `hover:bg-surface-raised`.
- Hairline separators between rows (`border-border-subtle`), inset to the
  text column — not boxes around groups.

## How a page is checked

Every page, at 390×844 and 1440×900, light and dark, signed in to the dense
local fixture (`scripts/seed-showcase.ts`):

- no horizontal scroll; no text cut mid-word at an edge;
- exactly one `<h1>`; no explanation line under it;
- nothing sticky besides top bar, bottom bar, composer;
- no element over the content on the right edge;
- at most one filled (primary) button visible on the first screen;
- every word passes rule 9.

`.tmp/crawl/crawl.mjs`-style screenshots before and after go with every
change, and a reviewer looks at them before it ships.
