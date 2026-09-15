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
.dot { width: 7px; height: 7px; border-radius: 50%; background: ${theme.accent}
.modes { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
.mode {
  font-size: 11px; padding: 4px 10px; border-radius: var(--rc, 6px);
  border: 1px solid var(--border, #333); color: var(--text-sec, #aaa);
  background: transparent;
}
.mode.on { border-color: var(--accent, #f60); color: var(--text, #fff); background: var(--accent-muted, rgba(255,102,0,.12)); }
.mode:disabled { opacity: .55; cursor: not-allowed; }
.mode-hint { font-size: 11px; color: var(--text-mut, #888); margin-top: 6px; line-height: 1.35; }
; flex: none; box-shadow: 0 0 0 3px ${theme.accentMuted}; }

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
.hdr .brand { display: flex; align-items: center; gap: 7px; color: ${theme.textSecondary}; margin-bottom: 7px; }
.hdr b { display: block; font-size: 15px; font-weight: 600; letter-spacing: -.01em; color: ${theme.text}; }
.hdr .page { font-size: 11px; color: ${theme.textTertiary}; margin-top: 3px; max-width: 280px; font-family: ${mono};
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x { color: ${theme.textSecondary}; width: 28px; height: 28px; border-radius: ${rc}; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; flex: none; }
.x:hover { color: ${theme.text}; background: ${theme.surfaceSubtle}; }

/* scope: one segmented control, not three loose chips */
.chips { display: flex; padding: 3px; gap: 2px; margin-bottom: 12px; border: 1px solid ${theme.border}; border-radius: ${rs}; background: ${theme.surfaceRaised}; }
.chip { flex: 1; padding: 7px 4px; font-size: 12px; border-radius: ${rc}; color: ${theme.textSecondary}; text-align: center; transition: background .12s ease, color .12s ease; }
.chip:hover { color: ${theme.text}; }
.chip.on { color: ${theme.text}; background: ${theme.surface}; box-shadow: inset 0 0 0 1px ${theme.borderStrong}; font-weight: 500; }
.hint { font-size: 11px; color: ${theme.accent}; margin: -4px 0 10px; }

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
.ok .track { display: inline-flex; margin-top: 14px; border-radius: 9px; padding: 9px 12px;
  background: ${theme.accent}; color: ${ink}; font-size: 12px; font-weight: 650; text-decoration: none; }

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
