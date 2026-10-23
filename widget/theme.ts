/**
 * Widget theme + the stylesheets built from it.
 *
 * The widget cannot see globals.css or Tailwind, so its colours arrive from
 * the boot response: Loki's own light and dark themes (WIDGET_THEMES,
 * generated from src/app/globals.css by scripts/generate-widget-theme.ts).
 * Never type a colour in here.
 *
 * Every stylesheet is written against `varTheme()` — each colour a
 * `var(--lk-…)` — and `themeVarsCSS()` defines those variables on the shadow
 * host twice, light and dark. Which one applies is an attribute on the host
 * (theme-mode.ts), so the panel follows Loki's mode without rebuilding a
 * single rule, and no variable is ever left undefined to fall back on.
 */

export type WidgetTheme = {
  accent: string;
  accentHover: string;
  accentMuted: string;
  /** Dark ink for text on the accent; older boot responses omit it. */
  inkOnAccent?: string;
  /** Radii and type from the design tokens; older boot responses omit them. */
  radiusControl?: string;
  radiusSurface?: string;
  fontSans?: string;
  fontMono?: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textMuted: string;
  surface: string;
  surfaceRaised: string;
  surfaceSubtle: string;
  border: string;
  borderStrong: string;
  borderDark: string;
  success: string;
  error: string;
  errorSurface: string;
  /** Older boot responses omit these three; see withDefaults. */
  warning?: string;
  /** The focus ring. */
  focus?: string;
  /** A picked element's outline on the HOST page — must read on any site. */
  highlight?: string;
  black: string;
  white: string;
};

export type WidgetThemes = { light: WidgetTheme; dark: WidgetTheme };

/** The colour keys, each of which becomes a `--lk-…` variable. */
const COLOR_KEYS = [
  "accent",
  "accentHover",
  "accentMuted",
  "inkOnAccent",
  "text",
  "textSecondary",
  "textTertiary",
  "textMuted",
  "surface",
  "surfaceRaised",
  "surfaceSubtle",
  "border",
  "borderStrong",
  "borderDark",
  "success",
  "warning",
  "error",
  "errorSurface",
  "focus",
  "highlight",
  "black",
  "white",
] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

const varName = (k: ColorKey) => `--lk-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** A theme from an older boot response, with the keys it predates filled from its own colours. */
function withDefaults(t: WidgetTheme): Required<WidgetTheme> {
  return {
    ...t,
    inkOnAccent: t.inkOnAccent ?? t.black,
    radiusControl: t.radiusControl ?? "6px",
    radiusSurface: t.radiusSurface ?? "8px",
    fontSans: t.fontSans ?? "system-ui, -apple-system, sans-serif",
    fontMono: t.fontMono ?? "ui-monospace, SFMono-Regular, Menlo, monospace",
    warning: t.warning ?? t.accent,
    focus: t.focus ?? t.accent,
    highlight: t.highlight ?? t.accent,
  };
}

/**
 * The theme every stylesheet is written against: each colour is its
 * variable, the rest (radii, fonts) the light theme's — they are the same in
 * both. Pair with themeVarsCSS in the same shadow root.
 */
export function varTheme(themes: WidgetThemes): Required<WidgetTheme> {
  const base = withDefaults(themes.light);
  const out = { ...base } as Record<string, string>;
  for (const k of COLOR_KEYS) out[k] = `var(${varName(k)})`;
  return out as Required<WidgetTheme>;
}

/**
 * The variables, defined on the host: light by default, dark when the host
 * carries data-lk-theme="dark" (theme-mode.ts sets it). color-scheme makes
 * the browser's own parts — scrollbars, the textarea caret — match.
 */
export function themeVarsCSS(themes: WidgetThemes): string {
  const block = (t: WidgetTheme) =>
    COLOR_KEYS.map((k) => `${varName(k)}: ${withDefaults(t)[k]};`).join(" ");
  return `:host { color-scheme: light; ${block(themes.light)} }
:host([data-lk-theme="dark"]) { color-scheme: dark; ${block(themes.dark)} }
`;
}

/** Both themes from a boot response; an older server sent one (dark) theme. */
export function themesFrom(body: {
  theme?: WidgetTheme;
  themes?: WidgetThemes;
}): WidgetThemes | null {
  if (body.themes?.light && body.themes.dark) return body.themes;
  return body.theme ? { light: body.theme, dark: body.theme } : null;
}

/**
 * The spiral status mark (dom.ts spiralMark): the logo, drawn in the accent,
 * that moves the way Loki is working — a slow turn while it watches, a quick
 * one while it thinks, still and grey when it is not watching. Shared by the
 * panel and the walkthrough card, which have separate stylesheets.
 */
export function spiralCSS(theme: Pick<WidgetTheme, "accent" | "textMuted">): string {
  return `
.dot.spiral { width: 15px; height: 15px; border-radius: 0; background: none; box-shadow: none; color: ${theme.accent}; display: inline-flex; flex: none; }
.dot.spiral svg { width: 100%; height: 100%; display: block; }
.dot.spiral.watching svg, .watching > .dot.spiral svg { animation: lokispin 9s linear infinite; }
.dot.spiral.thinking svg, .thinking > .dot.spiral svg { animation: lokispin 1.1s linear infinite; }
.dot.spiral.paused, .paused > .dot.spiral { color: ${theme.textMuted}; }
.dot.spiral.paused svg, .paused > .dot.spiral svg { animation: none; }
@keyframes lokispin { to { transform: rotate(-360deg); } }
@media (prefers-reduced-motion: reduce) { .dot.spiral svg { animation: none !important; } }
`;
}

export function buildShadowCSS(theme: WidgetTheme): string {
  const ink = theme.inkOnAccent ?? theme.black;
  const sans = theme.fontSans ?? "system-ui, -apple-system, sans-serif";
  const mono = theme.fontMono ?? "ui-monospace, SFMono-Regular, Menlo, monospace";
  // --radius-control / --radius-surface: controls 6px, surfaces 8px.
  const rc = theme.radiusControl ?? "6px";
  const rs = theme.radiusSurface ?? "8px";
  return `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; font-family: ${sans}; -webkit-font-smoothing: antialiased; }
button { cursor: pointer; border: none; background: none; color: inherit; font: inherit; }
button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid ${theme.focus ?? theme.accent}; outline-offset: 2px; }
.mono { font-family: ${mono}; letter-spacing: .08em; text-transform: uppercase; font-size: 10px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: ${theme.accent}; flex: none; box-shadow: 0 0 0 3px ${theme.accentMuted}; }
${spiralCSS(theme)}

/* No var() fallbacks anywhere in this file. The widget lives in a Shadow DOM under
   :host all:initial and defines no custom properties, so a var() with a hex
   fallback ALWAYS resolves to that fallback — a hardcoded colour wearing a
   token's clothes. Every colour interpolates from the boot theme, like the
   rest of this file. */

/* ---- launcher: a Loki pill, not an orange circle ----
   QUIET UNTIL WANTED. This sits on every client's site, in the corner of every
   page, forever. At full weight it competes with the page it is there to
   improve — on Diplodoctor it read as the most saturated thing on screen.
   So at rest it is small, translucent and shadowless: present enough to find,
   faint enough to forget. Hover or keyboard focus brings it to full weight
   with its label. (No "open" state: the launcher is display:none while the
   panel is up — see the rect guard below — so a rule for it would be dead.)
   The label is hidden at rest, not removed, so the accessible name never
   changes. */
.fab {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  display: inline-flex; align-items: center; gap: 9px;
  height: 40px; padding: 0 14px 0 12px; border-radius: 999px;
  background: ${theme.surface}; color: ${theme.text};
  border: 1px solid ${theme.borderDark};
  font-size: 13px; font-weight: 500; letter-spacing: -.01em;
  transition: transform .15s ease, opacity .2s ease, border-color .15s ease, box-shadow .2s ease, left .2s ease, top .2s ease;
  /* Small, but THERE. At 38% opacity and 85% size with a generic pencil it
     read as nothing at all: the owner, signed out on their own phone, looked
     at their site and said the widget was gone (2026-10-15) — and without
     the launcher there is no way to the sign-in that brings it back. Loki's
     own mark, at full strength, one hairline and a soft lift off the page. */
  box-shadow: 0 1px 2px rgba(0,0,0,.12), 0 4px 12px rgba(0,0,0,.12);
}
.fab .fab-label { display: none; }
.fab { touch-action: none; user-select: none; } .fab.dragging { cursor: grabbing; transition: none; } /* drag (launcher.ts): no page scroll under the finger */
.fab:hover, .fab:focus-visible {
  opacity: 1;
  transform: scale(1) translateY(-1px);
  border-color: ${theme.textSecondary};
  box-shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35);
}
.fab:hover .fab-label, .fab:focus-visible .fab-label { display: inline; }
@media (prefers-reduced-motion: reduce) { .fab { transition: opacity .2s ease; transform: none; } .fab:hover, .fab:focus-visible { transform: none; } }
.fab .fab-icon { display: none; width: 18px; height: 18px; }
.fab .fab-icon svg { width: 18px; height: 18px; display: block; }
@media (max-width: 480px) {
  /* Narrow viewports: content spans the full width, so collapse to an icon.
     It never fades or goes untappable while the page scrolls: a launcher at
     30% that ignored taps read as "sometimes transparent, sometimes broken"
     (G, 2026-10-22). Always solid, always tappable. */
  .fab { width: 44px; height: 44px; padding: 0; right: 12px; bottom: 12px; justify-content: center; }
  .fab .fab-label, .fab .fab-icon { display: none; }
  .fab .dot.spiral { width: 18px; height: 18px; }
}

/* The owner's launcher is the status of Loki on their site, in a word at
   every width: "● Watching" with a live dot, or "Paused". One button, one tap
   opens Loki (the "Point" half beside it read as the button, 2026-10-17).
   "Quiet until wanted" is for strangers on a client's site, not its owner. */
.fab.owner { opacity: 1; transform: none; height: 44px; padding: 0 16px 0 14px; box-shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35); }
.fab.owner .fab-label { display: inline; }
.fab.watching { border-color: ${theme.success}; }
.fab.owner::before { content: ""; width: 8px; height: 8px; border-radius: 50%; flex: none; background: ${theme.textMuted}; }
.fab.watching::before { background: ${theme.success}; animation: fcpulse 1.6s ease-in-out infinite; }
.fab.watching .fab-label { color: ${theme.text}; } .fab.paused .fab-label { color: ${theme.textSecondary}; }
/* The microphone INSIDE the owner's pill (quick-talk.ts): the pill widens to hold it, the button is drawn over that room — 44px to hit, a 36px circle to see. */
.fab.owner.with-talk { padding-right: 52px; }
.fab-talk { position: fixed; z-index: 2147483001; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border-radius: 50%; border: 4px solid transparent; background: ${theme.surfaceRaised}; background-clip: padding-box; color: ${theme.text}; cursor: pointer; touch-action: none; user-select: none; }
.fab-talk:hover, .fab-talk:focus-visible { background: ${theme.border}; } .fab-talk svg { width: 18px; height: 18px; display: block; }
.fab-badge {
  position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 999px; background: ${theme.accent}; color: ${ink};
  font-size: 11px; font-weight: 700; line-height: 18px; text-align: center;
}
.fab-bubble {
  position: fixed; z-index: 2147483000; max-width: min(300px, calc(100vw - 32px));
  display: flex; align-items: flex-start; gap: 8px; padding: 10px 10px 10px 12px; cursor: pointer;
  background: ${theme.surface}; color: ${theme.text}; font-size: 12px; line-height: 1.45;
  border: 1px solid ${theme.accent}; border-radius: ${rs}; box-shadow: 0 8px 32px rgba(0,0,0,.45);
}
.fab-bubble-text { min-width: 0; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.fab-bubble-x { flex: none; color: ${theme.textSecondary}; font-size: 11px; min-width: 44px; min-height: 44px; margin: -10px -10px -10px 0; }
@media (max-width: 480px) {
  /* Phone: the word stays — it is the whole point — at the phone's 44px. */
  .fab.owner { width: auto; height: 44px; padding: 0 14px 0 12px; gap: 8px; }
  .fab.owner .fab-label { display: inline; }
  .fab.owner .fab-icon { display: none; }
}
@media (prefers-reduced-motion: reduce) { .fab.watching::before { animation: none; } }

/* The edge tab: the launcher's second shape (launcher.ts, placeTab). A slim
   handle flush against the side edge for pages whose corners are busy — the
   Terminal, a composer, a wall of controls. Same button, same click, same
   long-press menu; only the shape changes, so it is never "missing". Wins over
   the narrow-viewport and owner rules above by specificity, not order. */
.fab.tab, .fab.tab.owner {
  width: 24px; height: 64px; padding: 0; gap: 0; justify-content: center;
  border-radius: ${rs} 0 0 ${rs}; border-right: 0;
  opacity: 1; transform: none; pointer-events: auto;
  box-shadow: 0 1px 2px rgba(0,0,0,.4);
}
.fab.tab.on-left { border-radius: 0 ${rs} ${rs} 0; border-right: 1px solid ${theme.borderDark}; border-left: 0; }
.fab.tab .fab-label, .fab.tab .fab-icon, .fab.tab .fab-badge, .fab.tab::before { display: none; }
/* The owner's tab still says whether Loki is watching — the same live dot as
   the corner button, above the mark — and is not faded: it is their status,
   in every shape (2026-10-18: the tab read as "a different widget"). */
.fab.tab.owner { width: 28px; height: 72px; flex-direction: column; gap: 8px; opacity: 1; }
.fab.tab.owner::before { display: block; }
.fab.tab.owner:hover, .fab.tab.owner:focus-visible { width: 32px; }
.fab.tab.owner .fab-badge { display: block; top: 2px; right: 2px; min-width: 16px; padding: 0 2px; font-size: 10px; }
.fab.tab .dot.spiral { display: inline-flex; width: 14px; height: 14px; }
.fab.tab:hover, .fab.tab:focus-visible { opacity: 1; width: 30px; transform: none; }

/* No backdrop beside a corner card: the panel says "use your site as usual",
   so the site stays bright and clickable next to it (2026-10-15: the owner's
   site sat greyed out behind a panel inviting them to use it). Close is ✕ or
   Escape. On a phone the sheet is UNDER the thumb, and a tap above it puts
   it away — there the backdrop stays, light. */
.backdrop { display: none; }

/* ---- panel: Loki's card ---- */
/* ONE scroll area. The header and the composer stay where they are; the
   thread between them takes the room left and scrolls. The whole panel used
   to scroll too, so on a laptop the composer sat under the fold of its own
   card and on a phone the thread scrolled inside a scrolling sheet. */
.panel {
  position: fixed; z-index: 2147483002;
  right: 16px; bottom: 16px; width: 380px; max-width: calc(100vw - 32px);
  max-height: min(calc(100vh - 32px), 720px); overflow: hidden;
  display: flex; flex-direction: column;
  background: ${theme.surface}; color: ${theme.text};
  border: 1px solid ${theme.borderStrong}; border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0,0,0,.5), 0 24px 64px rgba(0,0,0,.55);
  padding: 16px;
}
.grip { display: none; }
.panel > * { flex: none; }
.panel > .convo { flex: 1 1 auto; min-height: 0; }
@media (max-width: 480px) {
  .backdrop { display: block; position: fixed; inset: 0; z-index: 2147483001; background: rgba(0,0,0,.18); }
  /* Two thirds of the screen at most until they drag it up (sheet.ts): the
     site they are talking about stays in view above it. */
  .panel { max-height: 68vh; } @media (max-height: 700px) { .panel { max-height: 82vh; } .convo > .starters, .talk-hero-sub, .door-sub { display: none; } } .talk-hero { gap: 12px; margin: 0 0 8px; padding: 10px 14px; } .talk-hero-mic { width: 40px; height: 40px; } .talk-hero-mic svg { width: 20px; height: 20px; } /* the sheet is two thirds of a phone: the greeting, the hero and the way in must fit above the box */
  .panel { right: 0; bottom: 0; left: 0; width: 100%; max-width: none; border-radius: 12px 12px 0 0; border-bottom: none;
           padding-bottom: calc(16px + env(safe-area-inset-bottom)); transition: transform .2s ease, height .2s ease; }
  /* The sheet's handle: the grip and the header both drag (sheet.ts). */
  .grip { display: block; width: 36px; height: 4px; border-radius: 999px; background: ${theme.borderDark}; margin: -8px auto 10px; touch-action: none; }
  .hdr { touch-action: none; }
  /* Keyboard up (sheet.ts keyboardInset): the panel stands on the keyboard
     and fits what is visible, so the starters and the way into Loki step
     aside and the thread keeps the room. They return when the keyboard goes. */
  .panel.kb .starters, .panel.kb .continue, .panel.kb .ctxbar { display: none; } /* + "This page / Point to area": 40px the thread needs while the keyboard is up */
  .convo > .starters, .fc-kit .ck-replies { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; } .convo > .starters > .starter, .fc-kit .ck-reply { flex: none; white-space: nowrap; } .made-with .mw-more { display: none; } /* one row to swipe; "Made with Loki →" — specific enough to beat the base rules below */
  .panel.kb { padding-bottom: 12px; }
}
.hdr { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
/* The text column SHRINKS and the actions do not: with Review + Stop watching
   beside the close button, the owner's phone once pushed ✕ off the right edge
   (a flex item refuses to shrink below its content unless told to). */
.hdr > div:first-child { min-width: 0; flex: 1 1 auto; }
.hdr .brand { display: flex; align-items: center; gap: 7px; color: ${theme.textSecondary}; margin-bottom: 7px; }
.hdr b { display: block; font-size: 15px; font-weight: 600; letter-spacing: -.01em; color: ${theme.text}; }
.hdr .page { font-size: 12px; color: ${theme.textTertiary}; margin-top: 2px; max-width: 100%;
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x { color: ${theme.textSecondary}; width: 28px; height: 28px; border-radius: ${rc}; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; flex: none; }
.x:hover { color: ${theme.text}; background: ${theme.surfaceSubtle}; }

/* Header actions stay secondary to the conversation. */
.hdr-actions { display: flex; align-items: center; gap: 6px; flex: none; }
.speak > span:first-child { display: inline-flex; flex: none; }
.speak svg { display: block; width: 18px; height: 18px; }

.speak { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font-size: 12px; font-weight: 600; padding: 6px 8px; border-radius: ${rc}; color: ${theme.accent}; white-space: nowrap; }
.speak:hover { background: ${theme.surfaceSubtle}; }

/* "What Loki sees": the running notes of watch mode, one row until opened */
.thoughts { margin: -4px -16px 12px; padding: 0 16px; border-top: 1px solid ${theme.border}; border-bottom: 1px solid ${theme.border}; }
.thoughts-head { display: flex; align-items: center; gap: 8px; }
.panel.owner .hdr { display: none; } .panel.owner .thoughts { margin-top: -10px; border-top: none; } .panel.owner .thoughts-head .x { margin-right: -6px; } .thoughts.thinking .thoughts-row .dot.spiral svg { animation: lokispin 1.1s linear infinite; } /* owner: the status line IS the header (main.ts), ✕ ends it */
.panel.owner .thoughts-sum { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.35; } /* wrap, never "11 changes nee…" */
.thoughts-row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px; padding: 10px 0; min-height: 40px; text-align: left; font-size: 12px; color: ${theme.textSecondary}; }
.thoughts-toggle { flex: none; font-size: 12px; font-weight: 600; color: ${theme.textSecondary}; padding: 6px 0 6px 8px; }
.thoughts-toggle:hover { color: ${theme.text}; }
.thoughts-row:hover { color: ${theme.text}; }
.thoughts-sum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thoughts-chev { flex: none; color: ${theme.textTertiary}; transition: transform .15s ease; }
.thoughts.open .thoughts-chev { transform: rotate(90deg); }
.thoughts.needs-you .thoughts-sum { color: ${theme.text}; font-weight: 600; }
.thoughts-sub { padding: 4px 0 2px; font-size: 11px; color: ${theme.textTertiary}; }
.thoughts-list { list-style: none; margin: 0; padding: 0 0 12px; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.thought { display: flex; gap: 10px; font-size: 12px; line-height: 1.45; color: ${theme.textSecondary}; }
.thought-at { flex: none; width: 24px; font-family: ${mono}; font-size: 10px; line-height: 17px; color: ${theme.textMuted}; text-align: right; }
.thought-text { min-width: 0; overflow-wrap: anywhere; }
.thought.good .thought-text { color: ${theme.success}; }
.thought.warn .thought-text { color: ${theme.text}; }
.thought.warn .thought-at { color: ${theme.accent}; }
.thought.bad .thought-text { color: ${theme.error}; }

/* the one conversation */
.convo { display: flex; flex-direction: column; gap: 10px; overflow: hidden; } /* only the thread scrolls — README "Send is always reachable" */
.convo > * { flex: none; }
.convo > .chatlog { flex: 1 9999 auto; min-height: 0; }
.ctxbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; min-height: 36px; }
.scope { position: relative; min-width: 0; }
.scopebtn { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 4px 2px; font-size: 12px; color: ${theme.textSecondary}; }
.pointbtn { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 4px 2px; font-size: 12px; color: ${theme.accent}; }
.scopebtn:hover, .pointbtn:hover { color: ${theme.text}; }
.pointbtn svg { width: 16px; height: 16px; display: block; }
.scopemenu { position: absolute; z-index: 6; left: -8px; top: calc(100% + 4px); min-width: 152px; padding: 4px; border: 1px solid ${theme.borderStrong}; border-radius: ${rc}; background: ${theme.surfaceRaised}; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
.scopemenu[hidden] { display: none; }
/* "About" — this page / whole site / an element / Loki — one segmented
   control: four plain words in a row read as a sentence ("This page Whole
   site An element Loki itself"), and wrapped onto two lines on a laptop. One
   line always; on a narrow phone it scrolls sideways rather than wrap. */
.seg { display: flex; gap: 2px; padding: 2px; min-width: 0; overflow-x: auto; scrollbar-width: none;
       border-radius: ${rc}; background: ${theme.surfaceSubtle}; }
.seg::-webkit-scrollbar { display: none; }
.segbtn { display: block; width: 100%; flex: none; padding: 8px 10px; min-height: 40px; text-align: left; font-size: 12px; color: ${theme.textSecondary}; white-space: nowrap; border-radius: calc(${rc} - 2px); }
.segbtn:hover { color: ${theme.text}; }
.segbtn.on { color: ${theme.text}; background: ${theme.surfaceSubtle}; font-weight: 500; }
/* The control names itself (aria-label "What this is about") and the
   placeholder under it says the rest; a visible "About" cost the room the
   fourth choice needed on a 380px card. */
.ctx-label { display: none; }
/* composer: ONE card — what it is about, the words, then a row: tools left,
   the quiet way and the one accent way to send it right */
.composer { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid ${theme.borderStrong}; border-radius: ${rs}; background: ${theme.surfaceRaised}; transition: border-color .12s ease, box-shadow .12s ease; }
.composer:focus-within { border-color: ${theme.accent}; box-shadow: 0 0 0 3px ${theme.accentMuted}; }
.composer .chatinput, .composer .chatinput:hover, .composer .chatinput:focus { min-height: 48px; padding: 4px 0; border: none; background: transparent; box-shadow: none; }
/* Wraps rather than overflows: with a mic (every real browser) the row once
   pushed Ask Loki out of the panel. The tools are icons at rest; a recording's
   timer and a screenshot count still show, because then they say something. */
.composer-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
.composer-actions .tools { margin-right: auto; gap: 2px; }
.composer-actions .go, .composer-actions .ghost { height: 32px; padding: 0 12px; white-space: nowrap; }
.composer-actions .ghost { border: none; padding: 0 8px; }
.composer-actions .mic, .composer-actions .attach { height: 32px; min-width: 32px; padding: 0 8px; justify-content: center; border-color: transparent; }
.composer-actions .mic:not(.rec):not(.busy):not(.talk) span:last-child { display: none; }
.composer-actions .mic.talk { gap: 6px; color: ${theme.text}; }
.talk-hero { display: flex; align-items: center; gap: 14px; width: 100%; margin: 4px 0 12px; padding: 14px 16px; text-align: left; border: 1px solid ${theme.borderDark}; border-radius: ${rs}; background: ${theme.surfaceRaised}; color: ${theme.text}; transition: border-color .15s ease, transform .15s ease; }
.talk-hero:hover, .talk-hero:focus-visible { border-color: ${theme.text}; transform: translateY(-1px); }
.talk-hero-mic { flex: none; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: ${theme.text}; color: ${theme.surface}; box-shadow: 0 0 0 0 ${theme.error}; animation: talkinvite 2.4s ease-out 3; }
.talk-hero-mic svg { width: 22px; height: 22px; }
.talk-hero-words { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.talk-hero-title { font-size: 15px; font-weight: 600; }
.talk-hero-sub { font-size: 12px; line-height: 1.4; color: ${theme.textSecondary}; }
@keyframes talkinvite { 0% { box-shadow: 0 0 0 0 ${theme.borderDark}; } 70% { box-shadow: 0 0 0 10px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
@media (prefers-reduced-motion: reduce) { .talk-hero-mic { animation: none; } .talk-hero:hover { transform: none; } }
.mic.talk svg { width: 18px; height: 18px; }
.composer-actions .attach span:last-child { display: none; }
.composer-actions .attach.has span:last-child { display: inline; }
.tools { display: flex; gap: 8px; align-items: center; }
.msg.noticed { border-left: 2px solid ${theme.accent}; padding-left: 10px; }
.msg.noticed .who { color: ${theme.accent}; }
.noticed-actions { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; margin-top: 6px; }
.noticed-actions .act { margin-top: 0; align-self: center; }
/* Where the fix for this finding is — in place of a second "Fix this". */
.noticed-status { display: block; margin-top: 6px; font-size: 12px; line-height: 1.4; color: ${theme.textTertiary}; }
.noticed-go { display: inline-block; padding: 4px 0; font-weight: 600; color: inherit; text-decoration: underline; text-underline-offset: 2px; white-space: nowrap; }
.noticed-status.tone-accent { color: ${theme.accent}; }
.noticed-status.tone-positive { color: ${theme.success}; }
.noticed-status.tone-warning { color: ${theme.error}; }
@media (max-width: 380px) { .composer-actions .attach span:last-child { display: none; } }
/* Where the row has to wrap (the narrowest phones), the one way that leads
   wraps to the right edge, under the other way, not alone at the left. */
@media (max-width: 360px) { .composer-actions .go { margin-left: auto; } }
.act { align-self: flex-end; font-size: 12px; color: ${theme.textTertiary}; margin-top: -2px; }
.act:hover { color: ${theme.text}; }
/* the owner's door under the greeting: a link, aligned with Loki's bubble.
   Not an .act — those are "your words, as written" and a test counts them. */
.door { align-self: flex-start; font-size: 12px; color: ${theme.accent}; font-weight: 500; }
.door:hover { color: ${theme.accent}; }
.door-wrap { display: flex; flex-direction: column; gap: 2px; align-self: stretch; }
.door-sub { font-size: 11px; line-height: 1.45; color: ${theme.textTertiary}; }
/* Your changes: the owner's requests and where each one is, above the thread */
/* Your changes: one hairline strip like the notes above — a summary line that
   opens into the rows, each row its own link. */
.yours-body { display: flex; flex-direction: column; gap: 2px; padding-bottom: 10px; }
.yours-build { align-self: flex-start; margin: 4px 0 6px; min-height: 36px; padding: 0 14px; border-radius: 999px; font-size: 12px; font-weight: 600; background: ${theme.text}; color: ${theme.surface}; }
.yours-build:disabled { opacity: .6; cursor: default; }
.yours-list { display: flex; flex-direction: column; }
.yours-row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; column-gap: 10px; width: 100%; text-align: left; padding: 7px 0; font-size: 12px; line-height: 1.4; color: inherit; text-decoration: none; }
a.yours-row:hover .yours-text, button.yours-row:hover .yours-text { color: ${theme.accent}; }
.yours-dot { width: 7px; height: 7px; border-radius: 50%; background: ${theme.textMuted}; }
.yours-row.tone-accent .yours-dot { background: ${theme.accent}; }
.yours-row.tone-positive .yours-dot { background: ${theme.success}; }
.yours-row.tone-warning .yours-dot { background: ${theme.error}; }
.yours-text { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; color: ${theme.text}; }
.yours-status { font-size: 11px; color: ${theme.textTertiary}; white-space: nowrap; }
.yours-row.tone-positive .yours-status { color: ${theme.success}; }
.yours-row.tone-warning .yours-status { color: ${theme.error}; }
.yours-row.tone-accent .yours-status { color: ${theme.accent}; }
.yours-all { align-self: flex-end; font-size: 12px; color: ${theme.textSecondary}; text-decoration: none; }
.yours-all:hover { color: ${theme.text}; }
@media (pointer: coarse) { .yours-row { padding: 10px 0; } .yours-all { padding: 6px 0; } }
.yours-visitors { align-self: flex-end; font-size: 12px; color: ${theme.textTertiary}; text-decoration: none; }
.yours-visitors:hover { color: ${theme.text}; }
/* Continue in Loki: one quiet row under the composer, wrapping on a phone */
.continue { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; font-size: 12px; padding: 0 2px; }
.continue-label { color: ${theme.textTertiary}; }
.continue-link { color: ${theme.textSecondary}; font-weight: 500; }
.continue-link:hover { color: ${theme.accent}; }
@media (pointer: coarse) { .continue-link, .door { padding: 8px 0; } }
.msg.sent { border-left: 2px solid ${theme.success}; padding-left: 10px; }
.msg .track { display: inline-flex; margin-top: 6px; padding: 0; background: none; color: ${theme.accent}; font-size: 12px; font-weight: 600; }
.starter.primary { color: ${theme.accent}; border-color: ${theme.accent}; font-weight: 600; }
${sendCardCSS(theme, rs)}
@media (pointer: coarse) { .segbtn { min-height: 44px; padding: 10px; } .act { padding: 8px 0; } }
/* After the base .seg rule on purpose — same specificity, so order decides. */
@media (max-width: 480px) {
  /* What the message is about: ONE row that scrolls sideways, not two that
     wrap. With touch-sized tabs, "Loki itself" fell to a second line and the
     "About" label floated beside both (owner's phone, 2026-10-11). The label
     goes; the group keeps its name for screen readers (aria-label). */
  .ctxbar { min-width: 0; }
  .ctx-label { display: none; }
}

textarea, input {
  width: 100%; font-size: 13px; line-height: 1.45; color: ${theme.text};
  border: 1px solid ${theme.borderStrong}; border-radius: ${rs}; padding: 9px 11px; background: ${theme.surfaceRaised};
  transition: border-color .12s ease, box-shadow .12s ease;
}
textarea::placeholder, input::placeholder { color: ${theme.textMuted}; }
textarea:hover, input:hover { border-color: ${theme.borderDark}; }
textarea:focus, input:focus { outline: none; border-color: ${theme.accent}; box-shadow: 0 0 0 3px ${theme.accentMuted}; }
textarea { resize: none; min-height: 84px; }
.cnt { font-size: 10px; color: ${theme.textMuted}; text-align: right; margin: 4px 0 8px; font-family: ${mono}; }
.diag {
  font-size: 11px; color: ${theme.textSecondary}; background: ${theme.surfaceRaised};
  border: 1px solid ${theme.border}; border-radius: ${rc};
  padding: 5px 8px; margin: -4px 0 10px; cursor: help;
}
input { margin-bottom: 10px; }

/* secondary actions: quiet outlined buttons, one height, one voice */
.attachrow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; }
.attach, .mic {
  display: inline-flex; align-items: center; gap: 7px;
  height: 34px; padding: 0 12px; font-size: 12px; font-weight: 500; color: ${theme.textSecondary};
  border: 1px solid ${theme.borderStrong}; border-radius: ${rc}; background: transparent;
  transition: border-color .12s ease, color .12s ease, background .12s ease;
}
.attach:hover, .mic:hover { color: ${theme.text}; border-color: ${theme.borderDark}; background: ${theme.surfaceSubtle}; }
.attach svg, .mic svg { width: 14px; height: 14px; display: block; }
.shots { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; }
.shot { position: relative; display: inline-flex; }
.shot img { height: 44px; max-width: 84px; object-fit: cover; border-radius: ${rc}; border: 1px solid ${theme.borderDark}; }
.shot .rm {
  position: absolute; top: -6px; right: -6px; width: 18px; height: 18px;
  border-radius: 50%; background: ${theme.text}; color: ${theme.surface}; font-size: 10px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
/* An 18px dot is under any touch-target guideline. Keep the dot the same size
   visually and grow only the hit area, so the layout is unchanged but a thumb
   can actually land on it. */
@media (pointer: coarse) {
  .shot .rm::after { content: ""; position: absolute; inset: -13px; }
  .attach, .mic { height: 44px; padding: 0 14px; }
}
/* ---- visitor placement menu ---- */
.fabmenu {
  position: fixed; z-index: 2147483003;
  background: ${theme.surface}; color: ${theme.text};
  border: 1px solid ${theme.borderDark}; border-radius: ${rs};
  box-shadow: 0 8px 32px rgba(0,0,0,.5);
  padding: 4px; min-width: 190px;
}
.fabmenu-item { display: block; width: 100%; text-align: left; font-size: 13px; color: ${theme.text}; padding: 9px 10px; border-radius: ${rc}; }
.fabmenu-item:hover { background: ${theme.surfaceSubtle}; }
/* A menu is only reachable by long-press on touch, so its rows must clear the
   44px target guideline even though the launcher itself is smaller. */
@media (pointer: coarse) { .fabmenu-item { padding: 13px 12px; } }
/* ---- voice ---- */
.mic.rec { border-color: ${theme.accent}; color: ${theme.text}; background: ${theme.accentMuted}; }
.mic.busy { opacity: .7; cursor: default; }
/* The pulsing dot is the only thing that says "live" at a glance; motion is
   the signal, so honour a visitor who has asked for less of it. */
.mic .dot { animation: fcpulse 1.2s ease-in-out infinite; }
@keyframes fcpulse { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .mic .dot { animation: none; } }

.row { display: flex; gap: 8px; }
.go {
  flex: none; height: 34px; padding: 0 14px; background: ${theme.accent}; color: ${ink}; font-size: 13px; font-weight: 600;
  border-radius: ${rs}; letter-spacing: -.01em; transition: background .12s ease, opacity .12s ease;
}
.go:hover { background: ${theme.accentHover}; }
.go:disabled { cursor: default; background: ${theme.surfaceRaised}; color: ${theme.textMuted}; }
.ghost { height: 34px; font-size: 13px; color: ${theme.textSecondary}; padding: 0 10px; border-radius: ${rs}; }
.ghost:hover { color: ${theme.text}; background: ${theme.surfaceSubtle}; }
.err { font-size: 12px; color: ${theme.error}; margin-top: 8px; }
.err:empty { display: none; }
.keys { color: ${theme.textMuted}; text-align: center; margin-top: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.keys .sep { opacity: .6; }
.ok { text-align: center; padding: 26px 0 16px; }
.ok .tick { width: 44px; height: 44px; border-radius: 50%; background: ${theme.accent}; color: ${ink};
            display: inline-flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; }
.ok p { font-size: 13px; margin-top: 12px; color: ${theme.text}; }
.ok .sub { font-size: 11px; color: ${theme.textSecondary}; margin-top: 4px; }
.track { display: inline-flex; margin-top: 14px; border-radius: 9px; padding: 9px 12px;
  background: ${theme.accent}; color: ${ink}; font-size: 12px; font-weight: 650; text-decoration: none; }

/* ---- chat mode: one chat, two residents (the Cat and Loki) ----
   Bubbles are text only (answers are model output on someone else's site);
   the links under an answer come from the fleet map, styled as quiet chips so
   the first recommendation reads as the next step. */
.chat { display: flex; flex-direction: column; gap: 10px; }
.chatlog { display: flex; flex-direction: column; gap: 14px; overflow-y: auto; overscroll-behavior: contain; padding: 2px; }
/* The shared chat (widget/chat/): the same bounded thread as .chatlog; the
   widget's own actions sit under an answer, the card after the last turn. */
.fc-kit { display: flex; flex-direction: column; gap: 8px; }
.fc-kit { flex: 1 1 auto; min-height: 0; }
.convo > .kit-host, .kit-host > .fc-kit-root { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
/* Flex when chatkit makes the wrap a direct child; the cap bounds it
   however deep chatkit nests it, so the composer is never pushed out. */
.fc-kit .ck-thread-wrap { flex: 1 1 auto; min-height: 0; max-height: min(52vh, 440px); overflow-y: auto; }
/* The panel's own field styles (textarea:focus below) must not reach chatkit's
   input: it lives inside chatkit's composer frame, which draws the edge. Two
   rows, like the panel's own composer, so the placeholder is never cut. */
.fc-kit .ck-input, .fc-kit .ck-input:hover, .fc-kit .ck-input:focus { min-height: 3.25em; border: 0; background: transparent; box-shadow: none; border-radius: 0; }
.fc-kit-footer, .fc-kit-after { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-top: 6px; }
.fc-kit-after { padding: 0 2px; }
.fc-kit-after .sendcard { align-self: stretch; }
/* Loki's words are prose on the panel itself — no box — and yours are a
   pill, the way every good chat reads. Bordered bubbles on both sides plus
   bordered cards under them made the thread a stack of boxes. */
.msg { font-size: 13px; line-height: 1.55; max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.bot { color: ${theme.text}; align-self: stretch; }
.msg.user { max-width: 86%; padding: 8px 12px; border-radius: 16px; background: ${theme.surfaceSubtle}; color: ${theme.text}; align-self: flex-end; }
.msg.pending { color: ${theme.textTertiary}; }
.msg .rich { display: flex; flex-direction: column; gap: 8px; white-space: normal; }
.msg .rich p { white-space: pre-wrap; }
.msg .rich .rh { font-weight: 600; color: ${theme.text}; }
.msg .rich b { font-weight: 600; color: ${theme.text}; }
.msg .rich ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.msg .rich li::marker { color: ${theme.accent}; }
.msg.pending .who { display: flex; align-items: center; gap: 6px; }
.msg .who { display: block; margin-bottom: 3px; font-family: ${mono}; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: ${theme.textTertiary}; }
.msg.from-cat .who { color: ${theme.accent}; }
.msg .said { display: block; }
.msg.failed { color: ${theme.error}; background: ${theme.errorSurface}; padding: 8px 10px; border-radius: ${rs}; }
.chatlinks { display: flex; flex-wrap: wrap; gap: 6px; align-self: flex-start; max-width: 92%; }
.chatlink { font-size: 12px; font-weight: 500; color: ${theme.textSecondary}; text-decoration: none; padding: 6px 12px;
  border: 1px solid ${theme.borderStrong}; border-radius: 999px; background: transparent; }
.chatlink:first-child { color: ${theme.accent}; border-color: ${theme.accent}; }
.chatlink:hover { border-color: ${theme.accent}; }
.starters { display: flex; flex-wrap: wrap; gap: 6px; } .convo > .starters { flex: 0 1 auto; min-height: 0; overflow-y: hidden; } /* gives way before the composer does */
.starter { font-size: 12px; color: ${theme.textSecondary}; padding: 6px 12px; border: 1px solid ${theme.borderStrong}; border-radius: 999px; text-align: left; }
.starter:hover { color: ${theme.text}; border-color: ${theme.accent}; }
.chatform { display: flex; gap: 8px; align-items: flex-end; }
.chatform .chatinput { min-height: 44px; max-height: 120px; }
.chatform .go { flex: none; padding: 0 16px; height: 44px; }
@media (pointer: coarse) { .starter, .chatlink { padding: 11px 12px; } }
/* ---- ask mode: advice, then each recommended change one tap from a request ---- */
.msg.from-loki .who { color: ${theme.accent}; }
.changes { display: flex; flex-direction: column; align-self: stretch; margin-top: -4px; }
.changes-title { padding-bottom: 4px; font-family: ${mono}; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: ${theme.textTertiary}; }
/* Suggested changes are ONE decision: every row ticked to start, a tap
   unticks, and one action builds what is ticked as one change (suggestions.ts). */
.change { width: 100%; display: flex; align-items: flex-start; gap: 10px; padding: 9px 0; border-top: 1px solid ${theme.border}; text-align: left; }
.change-tick { flex: none; width: 16px; height: 16px; margin-top: 2px; border-radius: 50%; border: 1px solid ${theme.borderDark}; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; line-height: 1; color: ${ink}; }
.change.on .change-tick { background: ${theme.accent}; border-color: ${theme.accent}; }
.change.on .change-tick::after { content: "✓"; font-weight: 700; }
.changes.single .change-tick { display: none; }
.changes.single .change { cursor: default; }
.change-text { font-size: 13px; line-height: 1.45; color: ${theme.text}; min-width: 0; overflow-wrap: anywhere; }
.change:not(.on) .change-text { color: ${theme.textMuted}; }
.changes-foot { display: flex; align-items: baseline; justify-content: flex-end; gap: 16px; padding-top: 8px; border-top: 1px solid ${theme.border}; }
.changes-foot .act { align-self: auto; margin-top: 0; }
/* The action: the accent as TEXT, aligned at the end — never a stack of
   filled buttons down the right edge. Also "Fix this →" under a remark. */
.change-send { flex: none; font-size: 12px; font-weight: 600; color: ${theme.accent}; white-space: nowrap; }
.change-send:hover { color: ${theme.accentHover}; text-decoration: underline; text-underline-offset: 3px; }
.change-send:disabled { color: ${theme.textMuted}; cursor: default; text-decoration: none; }
@media (pointer: coarse) { .change-send, .changes-foot .act { padding: 8px 0; } }
/* ---- hiding: offered in the panel, and always says how to undo it ---- */
.panel-foot:not(:has(> :not([hidden]))) { display: none; } .panel-foot { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; column-gap: 16px; margin-top: 10px; }
.made-with { font-size: 12px; text-align: center; color: ${theme.textSecondary}; text-decoration: underline; text-underline-offset: 2px; } .hide-link { font-size: 12px; color: ${theme.textMuted}; text-decoration: underline; text-underline-offset: 2px; }
.made-with:hover { color: ${theme.text}; } .hide-link:hover { color: ${theme.textSecondary}; }
@media (pointer: coarse) { .hide-link, .made-with { padding: 12px 4px; } }
.toast {
  position: fixed; z-index: 2147483003; right: 16px; bottom: 16px; max-width: min(360px, calc(100vw - 32px));
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  background: ${theme.surface}; color: ${theme.text}; font-size: 12px; line-height: 1.4;
  border: 1px solid ${theme.borderDark}; border-radius: ${rs}; box-shadow: 0 8px 32px rgba(0,0,0,.5);
}
.toast-undo { flex: none; font-size: 12px; font-weight: 600; color: ${theme.text}; padding: 6px 10px; border: 1px solid ${theme.borderStrong}; border-radius: ${rc}; }

/* ---- element picker bar: the same surface, at the top ---- */
.pickbar {
  position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483002;
  background: ${theme.surface}; color: ${theme.text}; border: 1px solid ${theme.borderDark}; border-radius: 999px;
  padding: 6px 6px 6px 14px;
  display: flex; align-items: center; gap: 10px;
  box-shadow: 0 1px 2px rgba(0,0,0,.5), 0 12px 40px rgba(0,0,0,.5);
  font-size: 12px; max-width: min(640px, calc(100vw - 24px));
}
.pickbar .msg { flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px; overflow: hidden; white-space: nowrap; }
.pickbar .msg .lbl { overflow: hidden; text-overflow: ellipsis; color: ${theme.text}; }
.pickbar .msg .count { font-family: ${mono}; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: ${theme.textSecondary}; flex: none; }
.pickbar .go { flex: none; height: 30px; padding: 0 12px; font-size: 12px; border-radius: 999px; }
.pickbar .ghost { height: 30px; padding: 0 12px; font-size: 12px; border-radius: 999px; white-space: nowrap; }
@media (max-width: 480px) {
  .pickbar { left: 12px; right: 12px; transform: none; max-width: none; border-radius: 12px; }
}
/* Keyboard hints are noise on touch-only devices. */
@media (hover: none) and (pointer: coarse) {
  .keys { display: none; }
}
`;
}

/** Injected into document.head — the only styling that must reach host elements. */
/** The card a note is checked in before it goes, and the receipt after:
 *  one block, because they are one moment in the conversation. */
function sendCardCSS(theme: WidgetTheme, rs: string): string {
  return `
.sendcard { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid ${theme.accent}; border-radius: ${rs}; background: ${theme.surfaceRaised}; }
.sendcard textarea { min-height: 64px; }
.sendcard-sub { font-size: 12px; line-height: 1.45; color: ${theme.textSecondary}; }
.sendcard .voice-note textarea, .sendcard.voice-note textarea { min-height: 120px; max-height: 45vh; }
.sendcard-actions { flex-wrap: wrap; align-items: center; }
.ghost.outline { border: 1px solid ${theme.borderStrong}; color: ${theme.text}; }
.ghost.outline:hover { border-color: ${theme.borderDark}; }
/* A sent note under its receipt: whole lines, then "Show all" — never cut at the edge. */
.sent-full { margin-top: 6px; font-size: 12px; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.sent-full-text { align-self: stretch; padding: 8px 10px; border-left: 2px solid ${theme.border}; color: ${theme.textSecondary}; white-space: pre-wrap; overflow-wrap: anywhere; }
.sent-full-text.clamped { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.sent-full-more { min-height: 32px; padding: 0 2px; color: ${theme.textSecondary}; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
.sent-full-more:hover { color: ${theme.text}; }
.sendcard .err { margin-top: 0; }
.voice-note { gap: 14px; padding: 16px; border-color: ${theme.borderStrong}; }
.voice-note .changes-title { font: 500 16px/1.4 ${theme.fontSans ?? "system-ui,sans-serif"}; color: ${theme.text}; text-transform: none; letter-spacing: normal; }
.voice-note textarea { min-height: 160px; height: auto; max-height: 45vh; }
.voice-note .diag { font-size: 13px; line-height: 1.5; border: 0; padding: 0; margin: 0; background: transparent; }
.voice-note .row { flex-wrap: wrap; gap: 8px; }
/* Loki's read of a spoken note: the ask is short, so its box is too. */
.voice-note textarea.read { min-height: 72px; }
/* The words as spoken, one tap under Loki's read of them. */
.said-exact { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.said-exact summary { display: flex; align-items: center; min-height: 44px; cursor: pointer; color: ${theme.textSecondary}; font-weight: 500; list-style: none; }
.said-exact summary::-webkit-details-marker { display: none; }
.said-exact summary::after { content: " ↓"; white-space: pre; }
.said-exact[open] summary::after { content: " ↑"; }
.said-words { margin: 0; padding: 8px 10px; max-height: 30vh; overflow: auto; border-left: 2px solid ${theme.border}; color: ${theme.textSecondary}; white-space: pre-wrap; overflow-wrap: anywhere; }
.said-exact .act { align-self: flex-start; min-height: 44px; margin-top: 0; font-size: 13px; color: ${theme.text}; }
/* Loki's read as a list: one thing per line, what it is and where, words editable. */
.heard-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.heard-item { display: flex; flex-direction: column; gap: 2px; padding-left: 10px; border-left: 2px solid ${theme.borderStrong}; }
.heard-item.question { border-left-style: dashed; }
.heard-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: ${theme.textSecondary}; }
.heard-drop { min-width: 44px; min-height: 36px; border: 0; background: transparent; color: ${theme.textSecondary}; font-size: 14px; cursor: pointer; }
.voice-note textarea.heard-text { min-height: 0; max-height: none; padding: 2px 0; border-color: transparent; background: transparent; box-shadow: none; font-size: 15px; line-height: 1.45; resize: none; overflow: hidden; field-sizing: content; }
.voice-note textarea.heard-text:focus { padding: 2px 6px; border-color: ${theme.borderStrong}; }
`;
}

export function buildDocCSS(theme: WidgetTheme): string {
  // The HOST page cannot see the panel's variables, so this takes a concrete
  // theme — and one colour that is the same in light and dark, so a pick
  // never has to be redrawn when the mode changes.
  const mark = theme.highlight ?? theme.accent;
  // Solid, not dashed: a dashed outline reads as "broken", and the soft halo
  // makes the pick legible on busy backgrounds without repainting the element.
  return `
.fcw-hover { outline: 2px solid ${mark} !important; outline-offset: 3px !important; border-radius: 4px !important;
             cursor: crosshair !important; }
.fcw-selected { outline: 3px solid ${mark} !important; outline-offset: 3px !important; border-radius: 4px !important; }
`;
}
