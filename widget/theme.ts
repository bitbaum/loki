/**
 * Widget theme + the two stylesheets built from it.
 *
 * The widget cannot see globals.css or Tailwind, so every colour arrives from
 * the boot response (PALETTE.widget, generated from @bitbaum/design-tokens by
 * scripts/generate-widget-theme.ts). Never type a colour in here.
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
  black: string;
  white: string;
};

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
button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid ${theme.accent}; outline-offset: 2px; }
.mono { font-family: ${mono}; letter-spacing: .08em; text-transform: uppercase; font-size: 10px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: ${theme.accent}; flex: none; box-shadow: 0 0 0 3px ${theme.accentMuted}; }

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
  box-shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35);
  transition: transform .15s ease, opacity .2s ease, border-color .15s ease, box-shadow .2s ease;
  opacity: .38;
  transform: scale(.85);
  transform-origin: bottom right;
  box-shadow: none;
}
.fab .fab-label { display: none; }
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
  /* Narrow viewports: content spans the full width, so a fixed launcher sits
     on whatever scrolls into its corner (observed covering a pricing CTA at
     320px). Collapse to an icon, and get out of the way while the page is
     scrolling — taps during scroll-reading never hit the launcher instead of
     the page. */
  .fab { width: 40px; height: 40px; padding: 0; right: 12px; bottom: 12px; justify-content: center; }
  .fab .fab-label, .fab .dot { display: none; }
  .fab .fab-icon { display: block; }
  .fab.scrolling { opacity: .3; pointer-events: none; }
}

/* The owner's launcher is the status of Loki on their site: full weight,
   labelled, a live dot while it watches, a count of what it said meanwhile.
   "Quiet until wanted" is for strangers on a client's site, not its owner. */
.fab.owner { opacity: 1; transform: none; box-shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35); }
.fab.owner .fab-label { display: inline; }
.fab.watching { border-color: ${theme.accent}; }
.fab.watching .dot { animation: fcpulse 1.6s ease-in-out infinite; }
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
.fab-bubble-x { flex: none; color: ${theme.textSecondary}; font-size: 11px; padding: 0 2px; }
@media (max-width: 480px) {
  .fab.owner { width: auto; padding: 0 12px; }
  .fab.owner .fab-label { display: inline; font-size: 12px; }
  .fab.owner .fab-icon { display: none; }
  .fab.owner .dot { display: block; }
  .fab.owner.scrolling { opacity: 1; pointer-events: auto; }
}
@media (prefers-reduced-motion: reduce) { .fab.watching .dot { animation: none; } }

.backdrop { position: fixed; inset: 0; z-index: 2147483001; background: rgba(0,0,0,.35); }

/* ---- panel: Loki's card ---- */
.panel {
  position: fixed; z-index: 2147483002;
  right: 16px; bottom: 16px; width: 372px; max-width: calc(100vw - 32px);
  max-height: min(85vh, 680px); overflow-y: auto;
  background: ${theme.surface}; color: ${theme.text};
  border: 1px solid ${theme.borderStrong}; border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0,0,0,.5), 0 24px 64px rgba(0,0,0,.55);
  padding: 16px;
}
@media (max-width: 480px) {
  .panel { right: 0; bottom: 0; left: 0; width: 100%; max-width: none; border-radius: 12px 12px 0 0; border-bottom: none;
           padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
}
.hdr { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
/* The text column SHRINKS and the actions do not: with Review + Stop watching
   beside the close button, the owner's phone once pushed ✕ off the right edge
   (a flex item refuses to shrink below its content unless told to). */
.hdr > div:first-child { min-width: 0; flex: 1 1 auto; }
.hdr .brand { display: flex; align-items: center; gap: 7px; color: ${theme.textSecondary}; margin-bottom: 7px; }
.hdr b { display: block; font-size: 15px; font-weight: 600; letter-spacing: -.01em; color: ${theme.text}; }
.hdr .page { font-size: 11px; color: ${theme.textTertiary}; margin-top: 3px; max-width: 100%; font-family: ${mono};
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x { color: ${theme.textSecondary}; width: 28px; height: 28px; border-radius: ${rc}; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; flex: none; }
.x:hover { color: ${theme.text}; background: ${theme.surfaceSubtle}; }

/* header actions: Watch / Review, then close */
.hdr-actions { display: flex; align-items: center; gap: 6px; flex: none; }
.watchbtn { font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 999px; border: 1px solid ${theme.borderStrong}; color: ${theme.textSecondary}; white-space: nowrap; }
.watchbtn:hover { color: ${theme.text}; border-color: ${theme.accent}; }
.watchbtn.on { border-color: ${theme.accent}; background: ${theme.accentMuted}; color: ${theme.text}; }
.watch-offer { margin: -4px 0 12px; padding: 12px; border: 1px solid ${theme.border}; border-radius: ${rs}; background: ${theme.surfaceSubtle}; font-size: 12px; line-height: 1.5; color: ${theme.textSecondary}; }
.watch-offer b { display: block; color: ${theme.text}; font-size: 13px; margin-bottom: 4px; }
.watch-offer .sub { color: ${theme.textTertiary}; margin-top: 4px; }
.watch-offer .track { margin-top: 10px; }

/* the one conversation */
.convo { display: flex; flex-direction: column; gap: 10px; }
.ctxbar { display: flex; align-items: center; gap: 8px; }
.ctx-label { font-family: ${mono}; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: ${theme.textTertiary}; flex: none; }
/* "About": one segmented control — this page / whole site / an element */
.seg { display: flex; flex: 1; padding: 3px; gap: 2px; border: 1px solid ${theme.border}; border-radius: ${rs}; background: ${theme.surfaceRaised}; }
.segbtn { flex: 1; padding: 6px 4px; font-size: 12px; border-radius: ${rc}; color: ${theme.textSecondary}; text-align: center; white-space: nowrap; }
.segbtn:hover { color: ${theme.text}; }
.segbtn.on { color: ${theme.text}; background: ${theme.surface}; box-shadow: inset 0 0 0 1px ${theme.accent}; font-weight: 500; }
/* composer: the text, then one row — attach tools left, the two ways to send right */
.composer { display: flex; flex-direction: column; gap: 8px; }
.composer .chatinput { min-height: 64px; }
/* Wraps rather than overflows: with a mic (every real browser) the row once
   pushed Ask Loki out of the panel. The tools are icons at rest; a recording's
   timer and a screenshot count still show, because then they say something. */
.composer-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.composer-actions .tools { margin-right: auto; }
.composer-actions .go, .composer-actions .ghost { height: 38px; padding: 0 12px; white-space: nowrap; }
.composer-actions .mic, .composer-actions .attach { height: 38px; min-width: 38px; padding: 0 10px; justify-content: center; }
.composer-actions .mic:not(.rec):not(.busy) span:last-child { display: none; }
.composer-actions .attach span:last-child { display: none; }
.composer-actions .attach.has span:last-child { display: inline; }
.tools { display: flex; gap: 8px; align-items: center; }
.msg.noticed { border-color: ${theme.accent}; }
.msg.noticed .who { color: ${theme.accent}; }
.noticed-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 8px; }
.noticed-actions .act { margin-top: 0; align-self: center; }
@media (max-width: 380px) { .composer-actions .attach span:last-child { display: none; } }
.act { align-self: flex-end; font-size: 11px; color: ${theme.textSecondary}; text-decoration: underline; text-underline-offset: 2px; margin-top: -4px; }
.act:hover { color: ${theme.text}; }
/* the owner's door under the greeting: a link, aligned with Loki's bubble.
   Not an .act — those are "your words, as written" and a test counts them. */
.door { align-self: flex-start; font-size: 11px; color: ${theme.text}; font-weight: 500; text-decoration: underline; text-underline-offset: 2px; }
.door:hover { color: ${theme.accent}; }
/* Your changes: the owner's requests and where each one is, above the thread */
.yours { display: flex; flex-direction: column; gap: 6px; margin: -4px 0 12px; padding: 10px 12px; border: 1px solid ${theme.border}; border-radius: ${rs}; background: ${theme.surfaceSubtle}; }
.yours-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.yours-all { font-size: 11px; color: ${theme.textSecondary}; text-decoration: underline; text-underline-offset: 2px; white-space: nowrap; }
.yours-all:hover { color: ${theme.text}; }
.yours-list { display: flex; flex-direction: column; gap: 6px; }
.yours-row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; column-gap: 8px; font-size: 12px; line-height: 1.4; }
.yours-dot { width: 8px; height: 8px; border-radius: 50%; background: ${theme.textMuted}; }
.yours-row.tone-accent .yours-dot { background: ${theme.accent}; }
.yours-row.tone-positive .yours-dot { background: ${theme.success}; }
.yours-row.tone-warning .yours-dot { background: ${theme.error}; }
.yours-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${theme.text}; }
.yours-status { font-family: ${mono}; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: ${theme.textTertiary}; white-space: nowrap; }
.yours-row.tone-positive .yours-status { color: ${theme.success}; }
.yours-row.tone-warning .yours-status { color: ${theme.error}; }
.yours-go { grid-column: 2 / -1; justify-self: start; font-size: 12px; font-weight: 600; color: ${theme.text}; text-decoration: underline; text-underline-offset: 2px; }
.yours-go:hover { color: ${theme.accent}; }
@media (pointer: coarse) { .yours-go, .yours-all { padding: 6px 0; } }
/* Continue in Loki: one quiet row under the composer, wrapping on a phone */
.continue { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 12px; }
.continue-label { font-family: ${mono}; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: ${theme.textTertiary}; }
.continue-link { color: ${theme.text}; font-weight: 500; text-decoration: underline; text-underline-offset: 2px; }
.continue-link:hover { color: ${theme.accent}; }
@media (pointer: coarse) { .continue-link, .door { padding: 8px 0; } }
.msg.sent { border-color: ${theme.accent}; }
.msg .track { display: inline-flex; margin-top: 8px; }
.starter.primary { border-style: solid; border-color: ${theme.accent}; color: ${theme.text}; background: ${theme.accentMuted}; font-weight: 600; }
.sendcard { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid ${theme.accent}; border-radius: ${rs}; background: ${theme.surfaceSubtle}; }
.sendcard textarea { min-height: 64px; }
.sendcard .err { margin-top: 0; }
@media (pointer: coarse) { .segbtn, .watchbtn { padding: 10px 8px; } .act { padding: 8px 0; } }

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
  flex: 1; height: 38px; background: ${theme.accent}; color: ${ink}; font-size: 13px; font-weight: 600;
  border-radius: ${rs}; letter-spacing: -.01em; transition: background .12s ease, opacity .12s ease;
}
.go:hover { background: ${theme.accentHover}; }
.go:disabled { cursor: default; background: ${theme.surfaceRaised}; color: ${theme.textMuted}; }
.ghost { height: 38px; font-size: 13px; color: ${theme.textSecondary}; padding: 0 14px; border: 1px solid ${theme.borderStrong}; border-radius: ${rs}; }
.ghost:hover { color: ${theme.text}; border-color: ${theme.borderDark}; }
.err { font-size: 12px; color: ${theme.error}; margin-top: 8px; }
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
.chatlog { display: flex; flex-direction: column; gap: 8px; max-height: min(46vh, 380px); overflow-y: auto; padding: 2px; }
.msg { font-size: 13px; line-height: 1.5; padding: 9px 11px; border-radius: ${rs}; max-width: 92%; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.bot { background: ${theme.surfaceRaised}; border: 1px solid ${theme.border}; color: ${theme.text}; align-self: flex-start; }
.msg.user { background: ${theme.accentMuted}; border: 1px solid ${theme.accent}; color: ${theme.text}; align-self: flex-end; }
.msg.pending { color: ${theme.textTertiary}; }
.msg .who { display: block; margin-bottom: 3px; font-family: ${mono}; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: ${theme.textTertiary}; }
.msg.from-cat .who { color: ${theme.accent}; }
.msg .said { display: block; }
.msg.failed { color: ${theme.error}; background: ${theme.errorSurface}; }
.chatlinks { display: flex; flex-wrap: wrap; gap: 6px; align-self: flex-start; max-width: 92%; }
.chatlink { font-size: 12px; font-weight: 500; color: ${theme.text}; text-decoration: none; padding: 6px 10px;
  border: 1px solid ${theme.borderStrong}; border-radius: ${rc}; background: transparent; }
.chatlink:first-child { border-color: ${theme.accent}; background: ${theme.accentMuted}; }
.chatlink:hover { border-color: ${theme.accent}; }
.starters { display: flex; flex-wrap: wrap; gap: 6px; }
.starter { font-size: 12px; color: ${theme.textSecondary}; padding: 6px 10px; border: 1px dashed ${theme.borderStrong}; border-radius: ${rc}; text-align: left; }
.starter:hover { color: ${theme.text}; border-color: ${theme.accent}; }
.chatform { display: flex; gap: 8px; align-items: flex-end; }
.chatform .chatinput { min-height: 44px; max-height: 120px; }
.chatform .go { flex: none; padding: 0 16px; height: 44px; }
@media (pointer: coarse) { .starter, .chatlink { padding: 11px 12px; } }
/* ---- ask mode: advice, then each recommended change one tap from a request ---- */
.msg.from-loki .who { color: ${theme.accent}; }
.changes { display: flex; flex-direction: column; gap: 6px; align-self: stretch; padding: 10px; border: 1px solid ${theme.border}; border-radius: ${rs}; background: ${theme.surfaceSubtle}; }
.changes-title { font-family: ${mono}; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: ${theme.textTertiary}; }
.change { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.change-text { font-size: 12px; line-height: 1.45; color: ${theme.text}; min-width: 0; overflow-wrap: anywhere; }
.change-send { flex: none; font-size: 11px; font-weight: 600; color: ${theme.text}; padding: 5px 9px; border: 1px solid ${theme.accent}; border-radius: ${rc}; background: ${theme.accentMuted}; }
.change-send:hover { background: ${theme.accent}; color: ${ink}; }
@media (pointer: coarse) { .change-send { padding: 11px 12px; } }
/* ---- hiding: offered in the panel, and always says how to undo it ---- */
.made-with { display: block; margin: 14px auto 0; font-size: 11px; text-align: center; color: ${theme.textSecondary}; text-decoration: underline; text-underline-offset: 2px; }
.made-with:hover { color: ${theme.text}; }
.hide-link { display: block; margin: 10px auto 0; font-size: 11px; color: ${theme.textMuted}; text-decoration: underline; text-underline-offset: 2px; }
.hide-link:hover { color: ${theme.textSecondary}; }
@media (pointer: coarse) { .hide-link, .made-with { padding: 12px 8px; } }
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
export function buildDocCSS(theme: WidgetTheme): string {
  // Solid, not dashed: a dashed outline reads as "broken", and the soft halo
  // makes the pick legible on busy backgrounds without repainting the element.
  return `
.fcw-hover { outline: 2px solid ${theme.accent} !important; outline-offset: 3px !important; border-radius: 4px !important;
             box-shadow: 0 0 0 6px ${theme.accentMuted} !important; cursor: crosshair !important; }
.fcw-selected { outline: 2px solid ${theme.accent} !important; outline-offset: 3px !important; border-radius: 4px !important;
                box-shadow: 0 0 0 6px ${theme.accentMuted}, 0 0 0 7px ${theme.accent}55 !important; }
`;
}
