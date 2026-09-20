# Responsive Design — Loki Web App

**Created:** 2026-06-27  
**Last modified:** 2026-08-26  
**Last modified summary:** Public marketing surface rebuilt mobile-first — sticky 56px header, drawer owns theme + sign-in, viewport-relative display scale, `ui-public-section`/`ui-public-container` rhythm.

Loki is **mobile-first and dark-first**. Every authenticated route must be usable on a 320px-wide phone without horizontal page scroll, with primary actions reachable above the floating bottom nav.

## Breakpoints

Tailwind defaults (via `@theme inline` in `globals.css`):

| Token | Width | Shell behaviour |
| --- | --- | --- |
| (default) | `<640px` | Bottom nav pill, compact page headers, stacked layouts |
| `sm` | `≥640px` | Chip rows may wrap; some subtitles appear |
| `md` | `≥768px` | Sidebar visible; desktop top-bar search; duplicate page titles allowed |
| `lg` | `≥1024px` | Control workspace two-column rail + detail |

## Mobile chrome (Layer 1 tokens)

Defined in `src/app/globals.css` `:root`:

```
--mobile-nav-height       Bottom tab bar height
--mobile-nav-offset       Float gap above screen edge
--mobile-safe-bottom      env(safe-area-inset-bottom)
--mobile-chrome-bottom    Total bottom inset (nav + offset + safe area)
--app-topbar-height       Sticky AppTopBar height
--app-viewport-height     100svh − top bar − mobile chrome (phones)
```

**Rule:** full-height surfaces (Loki, Terminal, workspace terminal) use `.app-viewport-pane`, not ad-hoc `100vh` / `100dvh` math.

## Shell layout

```
.app-shell-frame          overflow-x-clip — no page-level horizontal bleed
.app-main                 padding-bottom: mobile chrome + 1rem
.app-page                 Standard page gutter (px-4 … md:px-8)
.app-page-compact         Tighter vertical padding for chat/terminal pages
.app-viewport-pane        Full remaining viewport height
```

Authenticated pages should still enter through `PageLayout` (see
`docs/branding-design.md` → App-shell layout SSOT). Mixing raw `app-page max-w-*`
with bespoke wrappers is the main source of inconsistent positioning across
routes.

Navigation:

- **Desktop (`md+`)**: `Sidebar` (Now / Fleet / Command + PIN-gated Private) + full `AppTopBar` search + `AccountMenu`
- **Mobile**: `AppTopBar` page label + icon search + `AccountMenu`; bottom bar is **Today · Control · Loki · Menu** — one entry point per loop section, plus Menu; the Menu sheet shows the same sections with their questions, and carries no footer
- **Account actions** (Settings, Download, appearance, lock private zone, sign out) live in `AccountMenu` only. They used to be duplicated in the sidebar footer and the Menu sheet footer — two account menus, neither called one, and none in the header where users look first.

## Component patterns

| Pattern | Class / component | Mobile note |
| --- | --- | --- |
| Page title | `PageTitle` | Hides when it duplicates `AppTopBar` label |
| Modals | `Modal` | Bottom-anchored on phones; `--mobile-chrome-bottom` inset |
| Drawers | `Drawer` + `ui-drawer-body` | Full width; safe-area padding on scroll body |
| Loki composer | `ui-loki-composer` | Stacks textarea + toolbar row on `<sm` |
| Control project rail | `ui-control-project-list` | Vertical list on phones; horizontal scroll removed |
| Horizontal filters | `overflow-x-auto ui-scroll-fade-right` | Today, Projects, Events, Prompts chip rows |
| Touch targets | the `pointer: coarse` floor in `globals.css` | Never restate the 44px number in JSX |
| Flow-page back link | `PageLayout back={{href,label}}` | Renders above the title, not stranded below it |
| Theme | `ThemeToggle` cycle button (`ui-theme-cycle-btn`) | One control cycles Light → Dark → Auto; select variant in Settings |

## Public / auth surfaces

`PublicSurface` + `ui-public-*` follow the same `THEME_OPTIONS` (Light / Dark / Auto) as the app shell — do not pin `.dark` on the public subtree, and **do not use `text-white/*` or `bg-white/*` outside a surface that is always dark** (`ui-public-download`, `ui-changelog-*`). The footer carried that pattern after the surface became theme-aware and was invisible white-on-white in Light.

**Header (`ui-public-nav`).** Sticky at every width; 56px on a phone. Public pages run 3,000–13,000 CSS px tall there, so navigation must not require a flick to the top.

| Piece | Phone (`<md`) | `md+` |
| --- | --- | --- |
| Brand | `<BrandMark responsive />` — 36px glyph, one-line 18px wordmark, no kicker | Full stacked lockup |
| Nav | `PublicNavTrigger` → full-screen drawer | `PublicNav` mega-menu |
| Theme cycle | inside the drawer footer | in the header |
| Sign in | inside the drawer | in the header |
| Primary CTA | always visible, `whitespace-nowrap`, short label ("Open app") | full label |

`PublicHeaderActions` — not `PublicSurface` — mounts the drawer, because it is the only public header piece that can call `auth()`: `PublicSurface` is imported by `AuthShell`, which client pages import, so the shell itself is bundled for the browser.

**Type scale.** Display classes are viewport-relative with a phone-sized floor; the rem ceiling keeps desktop unchanged. Never raise a floor above what 320–390px can render.

| Class | Floor | Ceiling |
| --- | --- | --- |
| `ui-public-hero-title` | `2.5rem` | `5.75rem` |
| `ui-public-page-title` | `2.25rem` | `4.5rem` |
| `ui-public-display-lg` | `2rem` | `3.75rem` |
| `ui-public-display-md` | `1.75rem` | `3rem` |
| `--public-title-min` | `34px` | `108px` |

**Rhythm.** Use `ui-public-section` (`py-14 sm:py-20 lg:py-24`), `ui-public-section-gap`, and `ui-public-container{,-narrow,-mid,-wide}` (16px gutter on phones) rather than ad-hoc `py-24` + `max-w-* px-6`.

**Long pages.** `ui-public-jumpbar` (anchor chip row) on `/roadmap`; `DocContents` renders the whitepaper TOC as a collapsed `<details>` below `sm` and an open `<nav>` above it — `open` is DOM state, so one element cannot be toggled by a breakpoint. `ui-public-code-pre` wraps on phones instead of adding a second scroll axis.

**Handheld content.** Fleet Runner is a desktop binary, so a phone visitor is offered a handoff (open the web app / copy the install link) instead of a `.deb` — `isHandheld()` in `DesktopDownload.tsx`, checked *before* OS sniffing (an Android UA contains "linux"; an iPhone UA contains "Mac"). The hero's secondary CTA is "See how it works" on phones, "Download runner" from `sm` up.

**Tap targets.** The `pointer: coarse` floor in `globals.css` is the only place a 44px minimum is stated — but `min-height` does nothing to an `inline` box. A standalone link needs `inline-flex` (`ui-public-link-standalone`, `ui-auth-hint-link`, `ui-link-muted`); links inside a sentence keep `ui-public-link` and are exempt under WCAG 2.5.5.

**16px inputs below `sm`.** Safari zooms the whole viewport in whenever a focused field is under 16px, then leaves the page scrolled sideways. Every field that a phone user actually types into is `text-base sm:text-sm`: `ui-input`, `ui-input-compact`, `ui-auth-input`, `ui-auth-prefix-input`, `ui-palette-input`, `ui-term-mcomposer-input`, and the Loki composer. Adding a new input class? Match that pattern rather than defaulting to `text-sm`.

## Audit commands

```bash
# Design-system colour/size violations in JSX
grep -rn "text-gray-\|bg-\[#\|text-\[1[0-9]px\]" src/components/ src/app/ --include="*.tsx"

# Ad-hoc viewport heights (should use app-viewport-pane instead)
grep -rn "100dvh\|100vh\|100svh" src/app src/components --include="*.tsx"

# Fixed min-widths that may overflow phones
grep -rn "min-w-\[" src/components src/app --include="*.tsx"
```

## Testing checklist

Before shipping UI changes, verify at **375×667** and **320×568**:

1. `/today`, `/control`, `/projects` — no horizontal scroll; bottom nav never covers primary CTAs
2. `/loki` — composer Send visible; history/filter drawers full width
3. `/terminal` — xterm fills pane; "My machine" tabs scroll horizontally above terminal
4. Modals (bootstrap project, run prompt) — actions above bottom nav
5. `/people` detail drawer — scroll + safe area
6. Landing `/` — hero readable; public nav drawer opens
7. Public pages in **Light** as well as Dark — the surface follows the theme, and a white-on-white regression is invisible in a dark-only pass

Run `pnpm run smoke` with dev server up for route health; Playwright viewport tests are planned but not yet in CI.

## Control page (`/control`)

Control's failure mode was never one bad component — it was **twelve sibling
full-width sections with no hierarchy**, and layout logic that started at `sm:`
(640px), which is above every phone. A 390px device therefore never got a
designed layout; it got the fallback (`flex-col`, full width, nothing aligned to
anything). Both are fixed, and both are easy to undo by accident:

**Write phone rules as the base and relax them at `sm:`/`md:`.** A rule that
only exists at `sm:` and up does not exist on a phone. The hero (`ui-hero-*`) is
the reference: base rules describe 320px, `sm:` only spends the extra room.

**The hero answers one question.** *Is anything waiting on me?* — headline,
the projects by name, and at most ONE button. It previously carried five things
(runner line + versions, refresh, new project, autopilot pulse, Pause fleet, a
four-chip counter row, an explanatory paragraph) and its loudest control was
Pause fleet, which a builder uses roughly never. Counters and builder state live
in a quiet foot line; autopilot and refresh live in `ControlSettingsSheet`.

**Small tasks are one queue, not many strips.** `ControlInbox` holds feedback
triage and widget coverage together, collapsed, capped at three rows per group,
nothing auto-expanding. Adding a third "just one more strip" to the page is the
regression this replaced — add a group to the inbox instead.

**Row actions are never primaries.** A list of filled buttons has no primary
whatever its colour. Filled (`ui-btn-primary`) is for the action on a whole
group; rows get `ui-btn-secondary`. Use the size axis `ui-btn-sm` — never invent
a fifth filled variant with a size baked into it (that is how `ui-btn-save`,
`ui-btn-submit`, `ui-btn-lg` and `ui-btn-ready-primary` all came to exist).

**Nothing may rely on hover to be legible.** Phones have none. `OutcomeStreak`
was five glyphs whose meaning lived in a `title`; it now states its summary in
words. A `title` is an enhancement, never the only copy of a fact.

## Sheets (`ui-sheet-*`)

Shared bottom-sheet shell — used by the terminal's session setup and Control's
fleet settings. The rule that decides what belongs in one: **settings, not
state.** Controls chosen deliberately, changed rarely, and never read while work
is in flight. State stays on the page.

## Voice and pictures

Both dispatch composers (Control's `PromptInput`, `TerminalComposer`) take voice
(Whisper, already wired) and images/text files by picker or paste via
`useAttachments`. A screenshot with no text is a valid send — the picture is the
instruction.

A terminal agent cannot read pixels, so an image is never forwarded: it is
described by the vision preflight and folded into the prompt as TEXT, server
side, in `lib/composer-attachments` — called from `/api/inject`,
`/api/control/tab-inject` and `/api/orchestration/run`. Do not fold client-side:
a client that forgets sends a prompt referring to a screenshot nobody looked at,
and that failure is silent.

## Terminal page (`/terminal`)

Below `md` the terminal is three pieces and nothing else: a one-line header (`TerminalMobileHeader` — session name, live dot, full-screen toggle), the screen, and the dock (`TerminalMobileDock`). Everything that is *setup* rather than *state* — source, session list, agent, input mode, text size, live-keystrokes — lives in `TerminalSessionSheet`, one tap behind the session name. The desktop chrome (source bar, tab strip, session bar, status row) is `hidden md:block`; there is one `TerminalView` shared by both.

**The key deck is the point.** A soft keyboard has no arrows, no Esc, no Tab and no Ctrl — exactly the keys an agent TUI asks its questions with — so `TerminalKeyDeck` supplies them as buttons that write raw bytes through `transport.sendKey`. Sequences are SSOT in `config/terminal-keys.ts`; the deck is layout, hold-to-repeat and haptics. Arrows and Backspace auto-repeat when held; Enter and the control codes deliberately do not. Keys fire on `pointerdown` with `preventDefault()` so a tap never moves focus and dismisses the keyboard.

Typing goes through `TerminalRawComposer`, not the xterm canvas: a real `<textarea>` (with `autoCorrect="off"`) that sends the line on Send, appending `\r` unless the ⏎ chip is toggled off. `liveKeys` (session sheet) hands the keyboard back to xterm and defaults per device — off on a phone, on at desktop widths. `useKeyboardInset` pads the surface by the height `visualViewport` says the soft keyboard is covering, so the deck sits on the keyboard rather than behind it.

**Expand** (`TerminalMobileShell`) switches to `.ui-term-mobile-fullscreen`: fixed `100svh`, hides mobile nav and top bar, body class `fc-terminal-fullscreen` locks scroll — and there the keyboard inset is exact, since `.app-main`'s nav padding is zeroed. Deep link after Loki dispatch: `/terminal?source=machine&tab=<projectKey>`.

Verified at 320 and 390 CSS px: no horizontal overflow, every keycap ≥44px, and the terminal keeps ~496px of the 844px screen (it had ~150px before).

**Overlays (drawers/modals):** opening any `Drawer` or `Modal` sets `body.fc-overlay-open` — hides bottom nav and top bar so full-screen project profiles and Loki slide-overs are not obscured. Audit: `node scripts/mobile-pages-audit.mjs`.

## Projects page layout

`/projects` uses a **sticky search + filter bar** (`ui-projects-sticky-bar`), one **attention card** per flagged project, then a **compact list** (`ui-projects-row`) capped at 25 rows with “Show all”. Freeform status values never render as filter chips — only lifecycle badges via `shortProjectStatus()` in `lib/projects-display.ts`. Duplicate entity names collapse server-side via `mergeDuplicateProjectRows()`.
