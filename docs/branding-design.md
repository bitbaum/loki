# Loki Branding & Design System

**Created:** 2026-03-01  
**Last modified:** 2026-08-14  
**Last modified summary:** Note app-shell layout SSOT drift (PageLayout / max-width / ad-hoc panels) as known debt alongside the four-layer visual SSOT.

**Decision: We are using Loki.**

This is the canonical reference (in addition to the executable SSOTs). It captures decisions, criteria, and best practices so future changes (rebrands, new surfaces, major visual updates) stay consistent with first principles and the existing four-layer discipline.

Loki is locked as the product name. The criteria below were used to evaluate alternatives (FleetJockey, FleetSurfer, MuppetMaster, shadofleet/shadefleet, shadyfleet/piracyfleet, fleetclown, etc.) and Loki was selected (and confirmed) because it best satisfies the requirements for fleet language, active command/control tone, serious infrastructure positioning, scalability to robotics, and ownability. Recent .com-available suggestions (including fleetclown.com) were considered for the domain advantage but rejected (see "Recent name evaluations" section).

## Brand SSOTs (never bypass)

- **TypeScript**: `src/config/brand.ts`
  - `APP_NAME`, `APP_SLUG`, `APP_DOMAIN`
  - Marketing: `MARKETING_TAGLINE`, `MARKETING_SUBTITLE`, `MARKETING_HERO_*`, `MARKETING_POSITIONING`, `APP_TAGLINE`, `APP_DESCRIPTION`, `APP_KICKER`
  - URL helpers and `PRODUCT_NAME` alias (use this in marketing copy instead of hardcoding the name).
  - `APP_EMAIL_FROM`
- **Client persistence**: `src/config/brand-storage.ts`
  - Cookie names, localStorage keys, push tags — all prefixed with `APP_SLUG`.
  - `LEGACY_*` constants are read-only migration paths from the pre-Loki rename.
- **Env aliases**: `src/lib/brand-env.ts` (`envAlias`, `smokeSessionToken`)
  - Resolves `APP_*` → `LOKI_*` → `COCKPIT_*` so old machine env vars keep working.
- **Shell**: `scripts/_brand.sh`
  - Same three core values + `_brand_env` (for legacy COCKPIT_* / LOKI_* transition) and `_brand_tmp`.
  - Sourced by daemons, installers, hooks, beacon, etc.
- **Domain / TLS**: Caddy vhost on the Hetzner box + DNS at the registrar (Infomaniak, `orangecat.ch` zone).
- **Everything else** (manifest, layouts, components, OG images, desktop) must import from the above or use the generated `ui-*` / CSS custom properties. No other source of truth for the name or core positioning strings.

Rebrand process (one sentence): edit the two SSOT files + Caddy vhost domain + registrar DNS. Then audit with `pnpm run check:design`, `grep` for the old name, update desktop assets, and test the installers + public surfaces.

## Name Selection Criteria (first principles)

A name must make the *right humans* understand the product instantly and feel confident using/running/buying/investing in it. It must also survive the product's actual roadmap.

Required:
- Preserves and amplifies the "fleet" language that already runs through every piece of copy and the architecture ("Run your fleet", "fleet scale", "fleet command", "Fleet Runner", "orchestrate ... at fleet scale", "robotic fleets").
- Evokes **active human command / control plane / direction / judgment** over distributed execution capacity. The scarce thing is the operator staying in the loop; the product is the durable layer that makes high-leverage direction possible.
- Tone: serious infrastructure / operating system / control layer for power users and teams. "Serious operators", "no compromises", "built for serious builders". Must travel to enterprise, investors, and "the same patterns for robotic fleets".
- Scalable beyond today's AI agents without sounding absurd or childish.
- Ownable in practice: available (or reasonably acquirable) .com or .app, matching social handles, no major trademark collisions in software/infra/robotics.
- Short, pronounceable, spellable slug. Works as a wordmark next to a simple geometric mark. Easy for support, logs, terminal commands, and "I use X".

Anti-patterns we have explicitly rejected in evaluations:
- Pure role names that describe the *user* instead of the system (e.g. "Jockey").
- Passive / flow / consumer metaphors that fight the "human direction is the bottleneck" and "command center" thesis (e.g. "Surfer").
- Anything that reads as toy, meme, or children's entertainment when said in an investor, enterprise, or power-user context (e.g. anything built on "Muppet" — plus the hard trademark block from Disney).
- Names that force us to rewrite the hero, mission, and "fleet orchestration" story.

Loki is the name because it positions the *product* as the authoritative command layer ("crown") over a fleet of execution, keeps the fleet language intact, sounds like durable infrastructure, and supports the long-term robotics vision. The control-window mark reinforces the "command center" and "control plane" essence.

## Visual Identity (the four-layer rule + brand mark)

**The rule (from CLAUDE.md and enforced by `scripts/check-design-system.sh`):**

1. **Layer 1 — globals.css `:root` / `.dark`**: All raw values (OKLCH colors, rem sizes, shadows, radii, tracking, public backdrop sizes, `--public-accent`, etc.). Never define a visual decision anywhere else.
2. **Layer 2 — globals.css `@theme inline`**: Maps Tailwind utilities to the Layer 1 vars (e.g. `text-text-primary`, `bg-surface-raised`, `shadow-panel-strong`).
3. **Layer 3 — globals.css `@layer components`**: Every recurring visual pattern becomes a named `ui-*` class. This is the SSOT for buttons, cards, panels, public/auth bands, download CTAs, sidebars, etc. New patterns that will appear 3+ times go here immediately.
4. **Layer 4 — JSX**: Only `ui-*` semantic classes + pure layout Tailwind (`flex`, `gap-`, `px-`, `min-h-11`, `rounded-xl`, `col-span-*`, etc.). No palette colors, no hex, no arbitrary `text-[10px]`, no `bg-[#...]`, no `shadow-[...]`, no `text-white/` outside the intentionally centralized `ui-public-*` and `ui-auth-*` definitions (those surfaces are always near-black and the opacities are part of the class contract).

**`--accent` is a SURFACE, not an accent colour** (the one token trap in Layer 2):

`--accent` / `--accent-foreground` are shadcn's *accent surface pair* — a background tone plus the text that sits on it. `--accent` is `oklch(0.14 0 0)` in dark and `oklch(0.96 0 0)` in light, i.e. one step from the page background in each theme. Written as a text or line colour it paints the element the same colour as what is behind it. Measured in a real browser before the 2026-08 fix: **contrast ratio 1.0 in dark and 1.03 in light** — the Control onboarding CTAs ("No install needed →", "Download for your OS →", "Start →", "Import →"), the email-verification "Learn more" link, four card hover borders, and the selected-repo checkbox were literally invisible, in both themes, on the first screen a new user sees.

| Want | Use | Not |
| --- | --- | --- |
| Accent text / icon | `text-accent-text` | `text-accent` |
| Accent border, hover highlight | `border-accent-primary` | `border-accent` |
| Filled accent control | `bg-accent-warm` + `text-on-accent` | `bg-accent` + `text-accent-foreground` |
| Subtle raised surface | `bg-surface-raised` | `bg-accent` |

`pnpm run check:design` now fails on any bare `(text|fill|stroke|border|ring|bg)-accent` in TSX. The general lesson: a token whose name reads like a colour may be half of a surface pair — check its OKLCH lightness against the background it will sit on before using it as ink.

**Brand mark (the geometric logo):**
- The single source of truth for the mark is `src/config/brand-mark.ts` (`BRAND_MARK` + `spiralPathD()`). `src/components/shell/BrandMark.tsx` renders it and must never hand-redraw the geometry — the config file says so in its own header. It is rendered with `currentColor` + semantic text tokens so it adapts to light/dark and context.
- `public/icon.svg` (PWA, apple, manifest) and every `opengraph-*.tsx` / `twitter-image.tsx` **must render the identical geometry** (scaled). They duplicate the paths for static/edge reasons but are annotated with "must stay visually identical".
- Never introduce a third mark. The crosshair/target that previously lived in the icon/OG was replaced (2026) to match the in-app control window because the latter better communicates "command center / control plane".
- The wordmark next to the mark always comes from `APP_NAME` (never a second source).
- Desktop ("Fleet Runner") currently uses its own header treatment ("LOKI" + "Fleet Runner") for native app feel; it should continue to feel authoritative and local while still being recognizably part of the same system.

**Public / auth / download surfaces:**
- Always dark (near-black) by design, even when the app is in light mode. This is why `ui-public-*` and `ui-auth-*` legitimately contain `text-white/xx` and `bg-white/xx` *inside the class definitions in globals.css only*. Components never use the opacity utilities directly.
- The massive black download band and CTAs use `--public-accent` (warm orange) for the hover/CTA state — defined once in Layer 1, referenced from the ui-public-download-cta hover rule.

**Desktop app styles — GONE.** `desktop/src/renderer/` was deleted in v0.7.4; `desktop/src/` is `main/` + `preload/` only. Fleet Runner renders the web app, so there is no second stylesheet to keep in sync. (`docs/HANDOFF.md` records this as "DO NOT bring it back".)
- Separate from the web four-layer system on purpose (native Electron window, different constraints, "local authoritative" feel).
- Uses its own minimal dark tokens + `fleet-*` and runner primitives.
- Shares the same `--public-accent` / warm orange value for consistency with marketing CTAs.
- Still imports `APP_SLUG` (and can import more) from the web brand SSOT where useful.

**Audit discipline (never skip):**
- `pnpm run check:design` (runs `scripts/check-design-system.sh`) — blocks on raw palette colors in TSX (except OG), raw recipe duplication outside globals, `ui-*` used via `@apply` in components, etc.
- The manual grep from CLAUDE.md for palette + arbitrary text sizes.
- Before any PR that touches UI: the above must be clean, and new recurring patterns must be extracted to Layer 3.

## Additional Best Practices & Gaps Addressed (2026)

- **Rebrand surface**: `PRODUCT_NAME` and the imported constants exist so marketing and most UI never hardcode the name. We cleaned several remaining user-visible literals (public header, settings, calendar/project empty states, onboarding, desktop responses, control hints and launch text) to use `APP_NAME` as part of finalizing the Loki decision.
- **Name locked**: Loki confirmed as the name. All criteria, rationale, and anti-patterns from evaluations are preserved in this doc and brand.ts for any future consideration (though none is planned).
- **High-flier esthetics & code (this review)**: Added CSS-only `fleet-live-pulse` animation (restrained breathing opacity) applied to running fleet indicators for a "command center is alive" feel without JS or excess. Subtle hover lift on metric cards and BrandMark mark for responsive command esthetics. Made AUTOMATION_HINT dynamic via getAutomationHint(APP_NAME) for SSOT. All changes preserve 4-layer discipline and were verified with audits.
- **Local storage / daemon keys / legacy**: Many "cockpit" strings are intentional during the long transition (localStorage keys, systemd units, `/tmp/cockpit-*` sentinels, env var fallbacks in `_brand_env`). Do not "clean" them without updating the migration logic and testing real user machines. New code should prefer `APP_SLUG` / `_brand_tmp`.
- **Tokens in JS contexts**: Currently design tokens live only in CSS (correct for 95% of the app). When we need numeric/color values in TypeScript (Recharts, canvas, Satori alternatives, status calculations, etc.) we will add `src/lib/tokens.ts` (or equivalent) that re-exports the *names* and lets runtime resolve from CSS vars or a small synced object. Do not duplicate raw OKLCH values in TS.
- **Domain strategy**: Current production is `loki.orangecat.ch` (self-hosted on Hetzner, Caddy in front). A clean short .com (or .app) remains the long-term goal for credibility, email, and typing. Name evaluations must treat domain + social handle availability as a first-class constraint, not an afterthought. Update `brand.ts` `APP_DOMAIN` + the Caddy vhost domain + registrar when we move.
- **Marketing content**: All public copy lives in `src/config/marketing-content.ts` (and pulls positioning from brand.ts). This is the place for hero, differentiation, mission, investors thesis, roadmap, etc. Components and pages stay presentation-only.
- **PWA / manifest / icons**: `public/manifest.json` + layout metadata + `public/icon.svg` are the current surface. They were updated to reference the unified control-window mark. Future work: provide PNG fallbacks at common sizes for broader compatibility, and a proper maskable icon variant.
- **Desktop app icons**: The Electron side still has placeholder comments ("in production add a real png/icns"). When shipping signed builds, the desktop/ build must produce branded .icns / .ico from the same mark.
- **OG / social images**: All use the same mark + `APP_NAME` / tagline from SSOT. Per-article and per-user variants exist and should continue to stamp the small brand mark in the corner for recognition.
- **Font & typography discipline**: Headings use the display font + `--tracking-display`. Micro / nano sizes and label tracking are CSS vars. Never put font-family or size literals for brand text in components.
- **Responsive / mobile (2026-06-27)**: All authenticated routes must work at 320px+ without horizontal page scroll. SSOT: `docs/development/responsive-design.md` + Layer 1 chrome tokens (`--mobile-chrome-bottom`, `--app-viewport-height`) and shell classes (`.app-viewport-pane`, `.app-page-compact`). Full-height chat/terminal pages must not use raw `100vh`/`100dvh` in JSX. Modals and drawers must clear the floating bottom nav on phones.
- **Theme (2026-06-27)**: One `ThemeToggle` cycle button (`ui-theme-cycle-btn`) — never three separate Light/Dark/Auto buttons. Placed in the account menu (top bar) and the public nav; Settings uses the `select` variant only. It was in the top bar directly until 2026-09-20, where `ui-theme-cycle-btn`'s border and fill made a preference the loudest control in a bar of ghost-circle status icons.

## When Evaluating Future Names or Visual Refreshes

Ask (in order):
1. Does it still let us say "Run your fleet" and "fleet command" without lying?
2. Does the name + mark make a serious builder or investor feel they are getting a trustworthy control layer / OS, or does it make them smile like it's a toy?
3. Can the mark be drawn in one color (currentColor) and still read at 16px and 512px?
4. If we ship robotic fleet orchestration in 3 years, will saying the name out loud still feel like the right abstraction?
5. Do we own the .com/.app + handles, or can we acquire them for a sane price?
6. Will a rebrand touch < 5 files for the name itself + the normal number of marketing/docs updates? (If more, the architecture of our SSOTs is broken.)

## Related Files & Commands

- `src/config/brand.ts`, `scripts/_brand.sh`
- `src/app/globals.css` (the single source for every visual decision)
- `scripts/check-design-system.sh` + the grep in CLAUDE.md
- `src/components/shell/BrandMark.tsx` (there is no `SidebarBrand.tsx`)
- `src/app/layout.tsx` (metadata), `public/manifest.json`, `src/app/opengraph-image.tsx` + siblings
- `src/config/marketing-content.ts`
- `pnpm run check:design`
- Desktop: `desktop/src/main/index.ts` only — there is no renderer (deleted v0.7.4)
- Docs: this file + `CLAUDE.md` (design system section) + `docs/desktop-app.md` (rebrand notes from the cockpit→loki pass)

The system exists to serve builders who run many projects and many agents at once. Every pixel and every syllable should make that human feel more in control, not less.

Keep the crown on the fleet.

## High-Flier Code + Design + Esthetics Review (executed)

**Approach (per instructions + concurrency awareness):** 
- Used todo_write for structured plan.
- Immediately executed via tools: git status/diff, zellij dump-layout + /tmp/claude-pane-* inspection, ~/.claude/sessions/Cockpit.md + project memory reads to detect other agent's focus (desktop Fleet Runner polish + "impeccable" web control feedback per their session; they have pushed runner commits; current uncommitted in this pane are the branding/design ones).
- Deep review: Multiple passes reading globals.css (full control section + hero), ControlPanel (structure, delegation to presenter/hooks), ControlFleetStatus, ProjectCard (factoring), AttentionBar, BrandMark, control-presenter snippets, public surfaces, metrics.
- Audits run repeatedly: `pnpm run check:design`, CLAUDE grep for violations, brand SSOT greps, literal name scans.
- Prioritized: High-impact (command "alive" feel, visual hierarchy for attention/ready/working), low-conflict (mostly globals.css + docs + small token-based esthetics in already-modified control files; avoided large logic changes in ControlPanel where other agent might target "feedback impeccable").
- Changes layered on top of prior unification/SSOT work. All verified post-edit. No new abstractions; pure CSS for animation; respected 4-layer, SSOT, first principles (simplicity, state/SSOT, serve the judgment user, correctness).

**Specific high-flier changes made in this round (on top of branding unification, pulse, hovers, SSOT cleanups):**
- **globals.css (design/esthetics):** Extended `.ui-control-hero` with very subtle 48px data-grid overlay (using existing --public-grid-stroke at low opacity + background-size). Evokes "mission control / fleet radar" for the command center without clutter or new tokens. Complements the radial accent. Added comment explaining the intent. Also added gentle hover response to `.ui-control-fleet-chip` for better interactive command feedback.
- **Additional prior in round:** CSS `fleet-live-pulse` keyframe + `.ui-control-fleet-live` (restrained 1.8s opacity breath on working count). Applied to running indicator in ControlPanel. Hover lift on `.ui-control-metric-card`. Transition + micro-scale on BrandMark mark. Left warning accent border on AttentionBar for calmer priority visual. Metric card and hero refinements.
- **Code quality:** Made AUTOMATION_HINT dynamic (getAutomationHint(APP_NAME)) in ControlFleetStatus. Added APP_NAME imports + interpolated in ControlPanel launch text, more control surfaces (calendar, github status, etc.). Removed more hard Loki literals.
- **Esthetics:** Subtle interactive responses (hover scale on brand mark, lift on metrics, pulse on live fleet state, accent rail on attention) to make the control surface feel responsive and "high-flier" premium command tool. Grid in hero adds depth for "serious operators" without breaking minimal x.ai restraint.
- **Docs:** Updated this file with decision lock, review process, specific changes, and "keep the crown" close. 

**Verification:** design check passed repeatedly. No violations. Type-safe. Concurrent awareness respected (focused on design system + esthetics layers; other agent session indicates runner focus primarily).

**Further opportunities noted (for human or next safe round):** 
- If other agent finishes control feedback, consider more live table polish or empty-state personality in ProjectOperationsView.
- Potential small ui-control- additions for "impeccable" runtime state feedback (e.g. better stale vs live badges).
- Dogfood the control panel with local runner active as suggested in other session.
- Any nits on public/landing esthetics or website hierarchy.

All changes serve the core: making the builder feel more in control, with clearer signals, more delightful yet restrained esthetics, and rock-solid code/SSOT.

## Focused Design & Esthetics Pass (code quality assumed complete)

**Scope:** Per user directive, this round prioritized pure design/esthetics improvements in the command/control surfaces and public areas. Avoided new code quality/SSOT changes except where they directly enabled better visuals. Built on prior high-flier work (grid in hero, pulse, hovers).

**Key esthetics enhancements executed:**
- Refined `.ui-control-live-empty`: softer dashed border, increased padding/rounding for calmer 'no data' state in live command view. Added icon in ZellijLivePanel.tsx for visual hierarchy and 'terminal ready' cue.
- Enhanced `.ui-control-live-composer` with rounded-2xl and subtle shadow for elevated input feel.
- Polished `.ui-control-live-input` with rounded-xl, focus ring for premium keyboard-driven command experience.
- Improved `.ui-control-project-row` and active state: 2xl rounding, hover lift/translate for tactile workspace rail.
- Metric cards: consistent 2xl, added hover translate-y for instrument-like response.
- Public download: added shadow to active platform, lift on idle, better cta hover with accent glow and scale for engaging CTA esthetics.
- Brand mark: subtle inner shadow in ui-brand-mark for depth; slight opacity tweaks in SVG for cleaner, more confident visual weight.
- Attention bar: 2xl rounding for softer priority strip.
- General: comments in CSS for 'high-flier command esthetics' intent, ensuring future maintainability.

**Verification:** design check clean. All changes Layer 3 (globals) or minimal Layer 4 (icon + rounding in one component). Preserved restrained, data-dense, x.ai-inspired dark command aesthetic while adding delightful micro-interactions and hierarchy.

**Rationale (first principles):** Esthetics must serve the user — make fleet state instantly scannable and the act of commanding feel powerful yet calm. Subtle animations (pulse, hovers, lifts) communicate 'alive system' without distraction. Consistent rounding/shadows reinforce premium infrastructure feel for serious builders.

Further polish possible in public landing hero or Today cards if needed.

## App-shell layout SSOT (known debt)

Visual tokens already have a four-layer SSOT (`CLAUDE.md` + `globals.css`). **Page
chrome does not yet:** authenticated routes mix `PageLayout` (`app-page` +
`ui-page-header`, default `max-w-4xl`), raw `app-page max-w-*`, and bespoke
wrappers (Control, project workspace, Loki, Terminal, Decisions, Agents, …).
That produces the “every page sits differently” feel (gutters, title row,
max-width, panel chrome).

**Rule going forward:**

1. Default app pages → `PageLayout` (only override `maxWidth` with a documented
   reason).
2. Recurring panels → `ui-panel` / `ui-list-row` / existing `ui-*` — not one-off
   `rounded-2xl border …` stacks.
3. Full-bleed tools (Loki, Terminal) → `.app-viewport-pane` only.

Tracked as incremental cleanup, not a big-bang redesign. Feedback Control strip
(2026-08-14) moved onto `ui-panel` as a small example.

## Recent Name Evaluations (shadefleet / shadyfleet etc.)

In 2026, user floated .com-available variants leaning on "shade/shady" + fleet: shadofleet.com / shadefleet.com / shadyfleet.com / piracyfleet.com (all claimed available at time of discussion).

**Evaluation against criteria:**
- Preserve "fleet": Yes.
- Evoke active human **command / control plane / direction / judgment**: No. "Shade/shady" strongly implies hidden, opaque, untrustworthy, stealthy or suspicious operations.
- Tone: serious infrastructure for serious builders / "nothing hidden": Direct contradiction. See Philosophy: "Nothing hidden. You always know what each agent is doing and why. No black boxes inside your own fleet." and "Built for serious operators."
- Real-world associations:
  - "Shadow fleet" / "shade fleet": Dominant modern usage = Russia's (and others') sanctioned oil tanker fleets evading Western sanctions, smuggling, high-risk/illegal maritime activity. Heavy news coverage on seizures, environmental damage, war funding. Toxic for a "trustworthy command center" and "operational trust" product.
  - "Shady fleet": Even worse — slang for dubious, sketchy, potentially criminal (e.g. "shady operators", contraband references in shipping/gaming contexts).
- Scalable to robotics: "My shadyfleet of robots" or "shadow fleet building the physical world" sounds dystopian/black-ops rather than empowering sovereign builder tool.
- Ownable: Domain win, but branding risk high (wrong audience: people seeking "shady" tools vs. serious power users/investors). Minor gaming/music collisions for "Shadefleet".
- Rebrand cost: High (SSOT in brand.ts + _brand.sh, 100s of references in code/docs/desktop/marketing/OG images/legal, daemons, installers, user mental models). Would require rewriting hero ("Run your fleet"), mission, "control layer" language.
- Visual/BrandMark fit: Current mark is a visible "control window" (rect + bars like a dashboard/terminal). "Shade" suggests dark/hidden, clashing with the explicit "command center" visual and "nothing hidden" principle.

**Verdict:** Rejected. The .com availability is tempting (current prod is loki.orangecat.ch), but names actively undermine core value prop (visibility + trust + sovereign control) and invite negative real-world baggage from sanctioned shipping. "Shadyfleet" worse than "shadefleet" due to stronger "untrustworthy" slang. "Piracyfleet" even more toxic (theft/illegal).

**Loki remains the name** because it positions the *product* as the authoritative command layer ("crown") over a fleet of execution. Keeps fleet language, serious durable infrastructure tone, supports robotics vision ("same control patterns").

If domain pressure is high, pursue purchasing loki.com (or .app / strong alternative) rather than changing name to fit available shady/shadow variants. These might suit a different product (e.g. underground stealth agent runner), not this one.

See also earlier evaluations in this doc for FleetJockey (role-name mismatch), FleetSurfer (passive flow vs. active command), MuppetMaster (toy/meme + IP issues).

**FleetClown.com (user suggestion, .com available):** 
- Preserves "fleet": Technically yes, but "clown" destroys any serious fleet-command meaning.
- Evokes active command/control: Catastrophic failure. "Clown" universally connotes foolishness, joke, circus performer, incompetence, or meme (e.g. "clown emoji" 🤡 for "this is ridiculous"). Direct opposite of "crown" (authority/sovereignty) and "command layer".
- Tone: "Serious operators", "infrastructure", "nothing hidden", "control plane for the age of autonomous creation": Utter mismatch. Saying "I use FleetClown for my agent fleet" or pitching investors "the control layer... FleetClown" would be career suicide. Reads as toy/meme in every context the criteria explicitly reject.
- Real-world: Searches turn up random fan art, games, insults, and "clown" used derisively. Zero positive infrastructure/software associations.
- Scalability: "My fleetclown of robots" sounds like a joke product or actual clown car of useless agents. Would require complete rewrite of every piece of marketing copy, investor thesis, hero ("Run your fleet" becomes comedy), and philosophy.
- Ownable: Domain available is the *only* positive. But the name itself creates massive trademark risk (clown IP, memes) and makes social handles toxic.
- Visual fit: BrandMark is a clean control-window/dashboard SVG. Pairing with "Clown" would look absurd next to the serious dark UI, ui-control-hero, etc.
- Rebrand cost: Highest possible — every file, every user, every external reference (README, CLAUDE.md, legal, desktop "Fleet Runner", marketing-content.ts, etc.) would need scrubbing. The "crown" etymology and control-window mark would have to be abandoned.

**Verdict:** Hard reject. This is the single worst suggestion in the entire evaluation history. It doesn't just fail the criteria — it inverts them. The domain availability does not come close to compensating for the permanent damage to credibility, tone, and positioning. If the goal is a memorable .com, Loki + acquiring loki.com (or creative variant) remains far superior. "Clown" variants belong in the rejected meme bucket with MuppetMaster, only worse because it actively mocks the "serious builders" audience.

Loki stays locked. "Clown" would make the entire "serious infrastructure" thesis a punchline.