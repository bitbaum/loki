/**
 * Loki Feedback Widget — self-contained embed for customer sites.
 *
 * Usage (docs/architecture/feedback-widget.md):
 *   <script src="https://<loki-host>/widget.js" data-fc-project="fcw_..." async></script>
 *
 * Constraints that shape this file:
 * - Zero dependencies, one bundle: it must mount on ANY site (static HTML,
 *   WordPress, Next, ...) — no React, no shared chunks.
 * - All UI lives in a Shadow DOM so host CSS and widget CSS can't bleed
 *   into each other. The ONE exception: element-picking highlights must
 *   style host-page elements, so a tiny fcw-* stylesheet is injected into
 *   document.head (removed classes on cleanup).
 * - The token is write-only by design; the API base is derived from this
 *   script's own src, so one snippet works on every deployment.
 */

import { buildSuggestion, formatDiagnostics, type ReportDiagnostics } from "./report-payload";
import {
  createVoiceRecorder,
  formatElapsed,
  isVoiceSupported,
  mergeTranscript,
  type VoiceRecorder,
} from "./voice";
import {
  avoidOffsetY,
  cornerEdges,
  CORNERS,
  DEFAULT_PLACEMENT,
  MAX_AVOID_SHIFT,
  normalizePlacement,
  probeCorner,
  type Placement,
} from "./placement";
import {
  defaultWidgetSurfaceMode,
  parseWidgetSurfaceModes,
  WIDGET_SURFACE_MODE_META,
  type WidgetSurfaceMode,
} from "./surface-modes";

type Scope = "element" | "page" | "site";
type SelectedEl = { elementType: string; elementText: string; selector: string };

const MAX_LEN = 2000;
const MAX_ELEMENTS = 10;
const MAX_SCREENSHOTS = 5;
/** Stop recording here. Kept under the server's ~2 min upload cap so the
 *  visitor is never told "too long" after they have already said it. */
const VOICE_MAX_MS = 110_000;

type WidgetTheme = {
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

interface ReportInput {
  /** Pre-filled first line so the visitor never faces an empty box. */
  message?: string;
  diagnostics?: ReportDiagnostics;
}

interface LokiApi {
  /**
   * True once the panel can actually be opened — i.e. the boot gate said
   * active AND mount() has run.
   *
   * A host needs this to decide what its own "Report" control should be. The
   * stub below is published synchronously and therefore exists even when the
   * widget will never render (token paused, boot unreachable); a host that
   * treats "report is a function" as "clicking will do something" ships a
   * button that silently no-ops. Read `ready` and fall back to a real link.
   */
  ready: boolean;
  report(input?: ReportInput): void;
}

function buildShadowCSS(theme: WidgetTheme): string {
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
function buildDocCSS(theme: WidgetTheme): string {
  // Solid, not dashed: a dashed outline reads as "broken", and the soft halo
  // makes the pick legible on busy backgrounds without repainting the element.
  return `
.fcw-hover { outline: 2px solid ${theme.accent} !important; outline-offset: 3px !important; border-radius: 4px !important;
             box-shadow: 0 0 0 6px ${theme.accentMuted} !important; cursor: crosshair !important; }
.fcw-selected { outline: 2px solid ${theme.accent} !important; outline-offset: 3px !important; border-radius: 4px !important;
                box-shadow: 0 0 0 6px ${theme.accentMuted}, 0 0 0 7px ${theme.accent}55 !important; }
`;
}

/** Client-side downscale so a phone photo never ships megabytes: longest edge
 *  ≤1280px, JPEG, quality stepped down until it fits the ingest cap. */
const MAX_SHOT_CHARS = 590_000; // ingest caps the data URL at 600k chars
function downscaleImage(file: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.8, 0.6, 0.4]) {
        const out = canvas.toDataURL("image/jpeg", quality);
        if (out.length <= MAX_SHOT_CHARS) return resolve(out);
      }
      resolve(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

const PENCIL_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';

const MIC_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>';

const CAMERA_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';

/** A fresh <span> each call — one node cannot sit in two places, and the label
 *  is rebuilt on every state change. */
/**
 * The visitor's own placement, per token, in localStorage.
 *
 * Scoped by token so a person who moved the launcher on one customer's site
 * does not silently move it on another. Every access is wrapped: Safari in
 * private mode throws on localStorage, and a widget that cannot render because
 * storage is unavailable would be a worse bug than one that forgets a
 * preference.
 */
const VISITOR_KEY = (token: string) => `fc-widget-pos:${token.slice(0, 24)}`;

function readVisitorPlacement(token: string): Placement | null {
  try {
    const raw = localStorage.getItem(VISITOR_KEY(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    // `hidden` is stored as a placement with a marker so one key covers both
    // "moved it" and "dismissed it".
    if (parsed && typeof parsed === "object" && (parsed as { hidden?: boolean }).hidden) {
      return { ...DEFAULT_PLACEMENT, autoAvoid: false, offsetX: -1 };
    }
    return normalizePlacement(parsed);
  } catch {
    return null;
  }
}

function writeVisitorPlacement(token: string, value: Placement | { hidden: true } | null): void {
  try {
    if (value === null) localStorage.removeItem(VISITOR_KEY(token));
    else localStorage.setItem(VISITOR_KEY(token), JSON.stringify(value));
  } catch {
    /* storage unavailable — the preference just doesn't persist */
  }
}

/** offsetX === -1 is the in-memory marker for "visitor hid this". */
function isHiddenByVisitor(p: Placement | null): boolean {
  return !!p && p.offsetX === -1;
}

function micIcon(): HTMLSpanElement {
  const span = h("span");
  span.innerHTML = MIC_SVG;
  return span;
}

/**
 * Prefer the thing the visitor meant (link/button/card) over decorative
 * children (img/svg/path/rect). Empty elementText on bare <img> / <rect> made
 * OrangeCat "make this clickable" reports useless for Dispatch fix.
 */
function resolvePickTarget(el: Element): Element {
  const interactive = el.closest(
    'a, button, [role="button"], [role="link"], summary, label, [tabindex]:not([tabindex="-1"])',
  );
  if (interactive instanceof Element) return interactive;

  let cur: Element | null = el;
  while (cur && /^(path|rect|circle|line|polyline|polygon|g)$/i.test(cur.tagName)) {
    cur = cur.parentElement;
  }
  if (cur && cur.tagName.toLowerCase() === "svg") {
    const wrap = cur.parentElement;
    if (wrap && wrap !== document.body) return wrap;
    return cur;
  }
  if (el.tagName.toLowerCase() === "img") {
    const wrap = el.closest("a, button, figure, [role='button'], article, li");
    if (wrap instanceof Element) return wrap;
  }
  return el;
}

function elementLabel(el: Element): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria.slice(0, 100);
  const alt = el.getAttribute("alt")?.trim();
  if (alt) return alt.slice(0, 100);
  const title = el.getAttribute("title")?.trim();
  if (title) return title.slice(0, 100);
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const tag = el.tagName.toLowerCase();
  if (text) {
    // A container's textContent is every word inside it run together
    // ("coldstart-sep10-2339Started from Loki · …", seen live). Name it
    // by its first heading, or the tag plus its opening words.
    if (el.children.length > 0 && text.length > 60) {
      const heading = el.querySelector("h1,h2,h3,h4,legend,summary,[role=heading]");
      const head = heading?.textContent?.replace(/\s+/g, " ").trim();
      return head
        ? `${tag}: ${head.slice(0, 60)}`
        : `${tag}: \u201c${text.slice(0, 40)}\u2026\u201d`;
    }
    return text.slice(0, 100);
  }
  return `<${tag}>`;
}

/** id / data-testid first; else tag + up to 2 classes (skip fcw-*). */
function generateSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
  const tag = el.tagName.toLowerCase();
  const cls = (el.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter((c) => c && !c.startsWith("fcw-"));
  if (cls.length > 0)
    return `${tag}.${cls
      .slice(0, 2)
      .map((c) => CSS.escape(c))
      .join(".")}`;
  return tag;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}

(() => {
  const script = document.currentScript as HTMLScriptElement | null;
  const token = script?.getAttribute("data-fc-project") ?? "";
  if (!token) {
    console.warn("[loki-widget] missing data-fc-project attribute");
    return;
  }
  const apiBase = script?.src ? new URL(script.src).origin : "";
  // Legacy escape hatch, kept working: px from the bottom edge, set in the
  // customer's own HTML. Superseded by the placement served from boot, which an
  // operator can change without touching their site — but an explicitly set
  // attribute still wins (see boot()).
  const bottomOffset = parseInt(script?.getAttribute("data-fc-bottom") ?? "", 10);
  // Modes are captured with the script tag (async scripts lose currentScript later).
  const modesAttr = script?.getAttribute("data-fc-modes") ?? "report,chat,watch";

  /** Filled by boot() before mount(); the launcher never paints without it. */
  let placement: Placement = { ...DEFAULT_PLACEMENT };
  /** Where the visitor dragged/parked it, if they did. Their choice outranks
   *  both the operator's and the auto-avoid, and only for them. */
  let visitorOverride: Placement | null = readVisitorPlacement(token);
  if (document.getElementById("loki-feedback-host")) return;

  // Publish the programmatic entry point SYNCHRONOUSLY, before the async boot
  // gate decides whether to render. A host page that calls report() from an
  // error toast must not have to know whether the widget has finished booting,
  // so calls made too early are held (latest wins — a double-click on "Report"
  // means the second click, not two panels) and replayed once mount() runs.
  // If the boot gate says inactive, the held report is simply never shown:
  // the widget is off, and a queued submission could not land anyway.
  let pendingReport: ReportInput | null = null;
  let liveReport: ((input: ReportInput) => void) | null = null;
  const api: LokiApi = {
    ready: false,
    report(input: ReportInput = {}) {
      if (liveReport) liveReport(input);
      else pendingReport = input;
    },
  };
  (window as unknown as { Loki?: LokiApi }).Loki = api;

  const mount = (theme: WidgetTheme) => {
    // ---- state ----
    let scope: Scope = "page";
    let picking = false;
    let selected: SelectedEl[] = [];
    let selectedNodes: Element[] = [];
    let hoverNode: Element | null = null;
    let submitting = false;

    // ---- shadow scaffold ----
    const host = h("div");
    host.id = "loki-feedback-host";
    const root = host.attachShadow({ mode: "open" });
    const style = h("style");
    style.textContent = buildShadowCSS(theme);
    root.appendChild(style);
    document.body.appendChild(host);

    const docStyle = h("style");
    docStyle.textContent = buildDocCSS(theme);

    // ---- FAB ----
    const fab = h("button", "fab");
    const fabIcon = h("span", "fab-icon");
    fabIcon.innerHTML = PENCIL_SVG;
    fab.append(h("span", "dot"), h("span", "fab-label", "Feedback"), fabIcon);
    fab.setAttribute("aria-label", "Give feedback");
    fab.setAttribute("aria-haspopup", "dialog");
    fab.addEventListener("click", openPanel);
    root.appendChild(fab);

    // ---- visitor escape hatch ----
    //
    // The last line of defence. Auto-avoid handles what it can measure and the
    // operator handles what they noticed; this is for the case both missed, and
    // it belongs to the one person it is actually blocking. Long-press on touch,
    // right-click on a pointer — both the platform-native "more options" gesture,
    // so neither needs a visible affordance cluttering a 48px button.
    const menu = h("div", "fabmenu");
    menu.setAttribute("role", "menu");
    menu.style.display = "none";

    const moveBtn = h("button", "fabmenu-item", "Move to other corner");
    moveBtn.setAttribute("role", "menuitem");
    moveBtn.addEventListener("click", () => {
      const cur = effective();
      // Cycle the corners rather than offering a picker: four taps returns you
      // to where you started, which is its own undo.
      const next = CORNERS[(CORNERS.indexOf(cur.corner) + 1) % CORNERS.length];
      visitorOverride = { ...cur, corner: next, offsetX: 16, offsetY: 16 };
      writeVisitorPlacement(token, visitorOverride);
      hideMenu();
      reposition();
    });

    const hideBtn = h("button", "fabmenu-item", "Hide on this site");
    hideBtn.setAttribute("role", "menuitem");
    hideBtn.addEventListener("click", () => {
      writeVisitorPlacement(token, { hidden: true });
      hideMenu();
      host.remove();
    });

    const resetBtn = h("button", "fabmenu-item", "Reset position");
    resetBtn.setAttribute("role", "menuitem");
    resetBtn.addEventListener("click", () => {
      visitorOverride = null;
      writeVisitorPlacement(token, null);
      hideMenu();
      reposition();
    });

    menu.append(moveBtn, hideBtn, resetBtn);
    root.appendChild(menu);

    function showMenu() {
      // Anchor to the launcher's own corner so the menu opens inward, never
      // off the edge of the viewport.
      const p = effective();
      const { x, y } = cornerEdges(p.corner);
      menu.style.left = menu.style.right = menu.style.top = menu.style.bottom = "";
      menu.style[x] = `${p.offsetX}px`;
      menu.style[y] = `${p.offsetY + 56}px`;
      menu.style.display = "";
      resetBtn.style.display = visitorOverride ? "" : "none";
      document.addEventListener("click", onDocClick, true);
    }
    function hideMenu() {
      menu.style.display = "none";
      document.removeEventListener("click", onDocClick, true);
    }
    function onDocClick(e: MouseEvent) {
      if (!host.contains(e.target as Node)) hideMenu();
    }

    fab.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu();
    });

    let pressTimer = 0;
    const startPress = () => {
      pressTimer = window.setTimeout(() => {
        pressTimer = 0;
        showMenu();
      }, 500);
    };
    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = 0;
      }
    };
    fab.addEventListener("touchstart", startPress, { passive: true });
    fab.addEventListener("touchend", cancelPress);
    fab.addEventListener("touchmove", cancelPress, { passive: true });
    fab.addEventListener("touchcancel", cancelPress);

    // Scroll-fade companion to the narrow-viewport CSS above: the class is
    // toggled on every viewport, but only the ≤480px media query styles it.
    let scrollSettle = 0;
    window.addEventListener(
      "scroll",
      () => {
        fab.classList.add("scrolling");
        clearTimeout(scrollSettle);
        scrollSettle = window.setTimeout(() => {
          fab.classList.remove("scrolling");
          reposition();
        }, 350);
      },
      { passive: true },
    );

    // ---- placement engine ----
    //
    // One routine for every viewport, replacing a mobile-only version that
    // reset to the base offset above 480px — which is exactly why the launcher
    // kept sitting on top of desktop chat widgets. Two distinct hazards, both
    // real, handled in one pass:
    //
    //   FOREIGN LAUNCHERS (any viewport). Intercom, Crisp, Tawk, Drift and most
    //   in-house AI buttons all default to bottom-right, same as us, and our
    //   near-max z-index means we cover theirs. Measured by rectangle, so it
    //   works against a vendor we have never heard of.
    //
    //   INTERACTIVE CONTROLS (narrow viewports). Content spans the full width,
    //   so whatever scrolls into the corner sits under the launcher and the FAB
    //   steals the tap — measured covering the /auth GitHub sign-in button at
    //   320px. Hit-testing catches this; rectangle-matching alone would not,
    //   because page content is not fixed-position.
    const INTERACTIVE = "a,button,input,select,textarea,summary,[role='button']";

    /** The visitor's choice wins over the operator's, and only for them. */
    const effective = (): Placement => visitorOverride ?? placement;

    const applyPlacement = () => {
      const p = effective();
      const { x, y } = cornerEdges(p.corner);
      // Clear both axes first: switching corners must not leave the old edge
      // set, which would pin the launcher to two opposite sides at once.
      fab.style.left = fab.style.right = fab.style.top = fab.style.bottom = "";
      fab.style[x] = `${p.offsetX}px`;
      fab.style[y] = `${p.offsetY}px`;
    };

    const reposition = () => {
      if (fab.style.display === "none") return; // panel open — rect is degenerate
      const p = effective();
      applyPlacement();
      if (!p.autoAvoid) return;

      const { y } = cornerEdges(p.corner);
      const own = fab.getBoundingClientRect();
      const foreign = probeCorner(host, own);
      let offsetY = avoidOffsetY(own, foreign, p.corner, p.offsetY);
      fab.style[y] = `${offsetY}px`;

      // Narrow only: step over page content the rectangle scan cannot see,
      // because ordinary content is not fixed-position.
      if (window.innerWidth <= 480) {
        for (let i = 0; i < 10; i++) {
          const r = fab.getBoundingClientRect();
          const pts: Array<[number, number]> = [
            [r.left + 3, r.top + 3],
            [r.right - 3, r.top + 3],
            [r.left + 3, r.bottom - 3],
            [r.right - 3, r.bottom - 3],
            [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
          ];
          const covered = pts.some(([px, py]) =>
            document
              .elementsFromPoint(px, py)
              .some((el) => el !== host && !host.contains(el) && el.closest(INTERACTIVE) !== null),
          );
          if (!covered) break;
          offsetY += 16;
          if (offsetY - p.offsetY > MAX_AVOID_SHIFT) break;
          fab.style[y] = `${offsetY}px`;
        }
      }
    };

    reposition();
    // Chat widgets and consent bars inject themselves well after first paint,
    // and fonts/hydration shift what sits under the corner. Re-check at two
    // horizons rather than once: 800ms catches layout settle, 2.5s catches a
    // third-party script that boots lazily.
    window.setTimeout(reposition, 800);
    window.setTimeout(reposition, 2500);
    let resizeSettle = 0;
    window.addEventListener(
      "resize",
      () => {
        clearTimeout(resizeSettle);
        resizeSettle = window.setTimeout(reposition, 150);
      },
      { passive: true },
    );

    // ---- panel (built once, shown on demand) ----
    const backdrop = h("div", "backdrop");
    backdrop.addEventListener("click", closePanel);

    const panel = h("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Loki");

    const hdr = h("div", "hdr");
    const hdrText = h("div");
    // The brand line is what makes this recognisably Loki on a stranger's
    // site — the same mono micro-label Loki's own pages use.
    const brand = h("div", "brand");
    brand.append(h("span", "dot"), h("span", "mono", "Loki"));
    hdrText.appendChild(brand);
    // Surface modes: Report ships today; Chat / Watch are progressive seams
    // (data-fc-modes="report,chat,watch"). The whole panel is Loki-on-the-site.
    const enabledModes = parseWidgetSurfaceModes(modesAttr);
    let surfaceMode: WidgetSurfaceMode = enabledModes.includes(defaultWidgetSurfaceMode())
      ? defaultWidgetSurfaceMode()
      : enabledModes[0]!;
    const modesRow = h("div", "modes");
    modesRow.setAttribute("role", "tablist");
    modesRow.setAttribute("aria-label", "Loki modes");
    const modeHint = h("div", "mode-hint");
    const modeBtns = new Map<WidgetSurfaceMode, HTMLButtonElement>();
    function syncModes() {
      for (const [m, btn] of modeBtns) {
        const meta = WIDGET_SURFACE_MODE_META[m];
        btn.classList.toggle("on", m === surfaceMode);
        btn.setAttribute("aria-selected", m === surfaceMode ? "true" : "false");
        btn.disabled = !meta.shipped;
        btn.title = meta.hint;
      }
      modeHint.textContent = WIDGET_SURFACE_MODE_META[surfaceMode].hint;
    }
    for (const m of enabledModes) {
      const meta = WIDGET_SURFACE_MODE_META[m];
      const btn = h("button", "mode", meta.label);
      btn.setAttribute("role", "tab");
      btn.addEventListener("click", () => {
        if (!WIDGET_SURFACE_MODE_META[m].shipped) return;
        surfaceMode = m;
        syncModes();
      });
      modeBtns.set(m, btn);
      modesRow.appendChild(btn);
    }
    hdrText.appendChild(modesRow);
    hdrText.appendChild(modeHint);
    syncModes();
    hdrText.appendChild(h("b", undefined, "What should change?"));
    const hdrPage = h("div", "page");
    hdrText.appendChild(hdrPage);
    const closeBtn = h("button", "x", "✕");
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", closePanel);
    hdr.append(hdrText, closeBtn);

    const chips = h("div", "chips");
    const chipDefs: Array<{ key: Scope; label: string }> = [
      { key: "element", label: "An element" },
      { key: "page", label: "This page" },
      { key: "site", label: "Whole site" },
    ];
    const chipEls = new Map<Scope, HTMLButtonElement>();
    for (const def of chipDefs) {
      const chip = h("button", "chip", def.label);
      chip.addEventListener("click", () => {
        scope = def.key;
        if (def.key === "element") startPicking();
        syncChips();
      });
      chipEls.set(def.key, chip);
      chips.appendChild(chip);
    }
    const hint = h("div", "hint");

    const textarea = h("textarea");
    textarea.maxLength = MAX_LEN;
    textarea.placeholder = "What should be improved?";
    const cnt = h("div", "cnt", `0/${MAX_LEN}`);

    // Diagnostics travel with the submission but stay OUT of the textarea: the
    // visitor should see a clean sentence they can edit, not a wall of context
    // they have to scroll past or delete.
    let diagnostics: ReportDiagnostics | null = null;
    const diagNote = h("div", "diag");
    function syncDiagnostics() {
      const text = diagnostics ? formatDiagnostics(diagnostics) : "";
      diagNote.style.display = text ? "block" : "none";
      diagNote.textContent = text ? "⚙ Technical details attached" : "";
      diagNote.title = text;
    }
    syncDiagnostics();
    textarea.addEventListener("input", () => {
      cnt.textContent = `${textarea.value.length}/${MAX_LEN}`;
      sendBtn.disabled = !textarea.value.trim();
    });

    const contact = h("input");
    contact.type = "text";
    contact.placeholder = "Name / email (optional)";
    contact.autocomplete = "off";
    // Same cap the ingest route enforces, so the field stops accepting text at
    // the limit instead of taking it and losing the whole report on submit.
    // The textarea already does this; the contact input did not.
    contact.maxLength = 200;

    // ---- image attach (file picker + paste; client-downscaled) ----
    let shots: string[] = [];
    const attachRow = h("div", "attachrow");
    const fileInput = h("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    const attachBtn = h("button", "attach");
    const cameraIcon = h("span");
    cameraIcon.innerHTML = CAMERA_SVG;
    attachBtn.append(cameraIcon, h("span", undefined, "Screenshots"));
    attachBtn.setAttribute("aria-label", "Add screenshots (or paste)");
    attachBtn.addEventListener("click", () => fileInput.click());
    const shotsContainer = h("div", "shots");
    // ---- voice input ----
    // Progressive enhancement: on a browser without MediaRecorder, or on an
    // insecure origin where getUserMedia is undefined, no button is created at
    // all. A control that cannot work is worse than no control.
    let micBtn: HTMLButtonElement | null = null;
    let voice: VoiceRecorder | null = null;
    if (isVoiceSupported()) {
      micBtn = h("button", "mic");
      const micLabel = h("span", undefined, "Record");
      micBtn.append(micIcon(), micLabel);
      micBtn.setAttribute("aria-label", "Record your feedback by voice");

      voice = createVoiceRecorder({
        endpoint: `${apiBase}/api/widget/transcribe`,
        token,
        maxMs: VOICE_MAX_MS,
        onTranscript: (text) => {
          textarea.value = mergeTranscript(textarea.value, text, MAX_LEN);
          cnt.textContent = `${textarea.value.length}/${MAX_LEN}`;
          sendBtn.disabled = !textarea.value.trim();
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        },
        onState: (state, detail) => {
          if (!micBtn) return;
          micBtn.classList.toggle("rec", state === "recording");
          micBtn.classList.toggle("busy", state === "requesting" || state === "transcribing");
          micBtn.disabled = state === "requesting" || state === "transcribing";
          micBtn.replaceChildren();
          if (state === "recording") {
            micBtn.append(
              h("span", "dot"),
              h("span", undefined, `Stop ${formatElapsed(detail?.elapsedMs ?? 0)}`),
            );
            micBtn.setAttribute("aria-label", "Stop recording and transcribe");
          } else if (state === "transcribing") {
            micBtn.append(h("span", undefined, "Transcribing…"));
          } else if (state === "requesting") {
            micBtn.append(h("span", undefined, "Allow mic…"));
          } else {
            micBtn.append(micIcon(), h("span", undefined, "Record"));
            micBtn.setAttribute("aria-label", "Record your feedback by voice");
          }
          // Errors share the panel's one error line rather than inventing a
          // second place to look. Clearing on any non-error state means a
          // successful retry visibly clears the previous failure.
          errEl.textContent = state === "error" ? (detail?.error ?? "Microphone failed") : "";
        },
      });

      micBtn.addEventListener("click", () => {
        const s = voice!.state();
        if (s === "recording") voice!.stop();
        else if (s === "idle" || s === "error") void voice!.start();
      });
    }

    if (micBtn) attachRow.append(micBtn);
    attachRow.append(attachBtn, fileInput);

    function renderShots() {
      shotsContainer.textContent = "";
      for (let i = 0; i < shots.length; i++) {
        const shotWrap = h("span", "shot");
        const shotImg = h("img");
        shotImg.alt = `Screenshot ${i + 1}`;
        shotImg.src = shots[i];
        const shotRm = h("button", "rm", "✕");
        shotRm.setAttribute("aria-label", `Remove screenshot ${i + 1}`);
        const idx = i;
        shotRm.addEventListener("click", () => {
          shots.splice(idx, 1);
          renderShots();
        });
        shotWrap.append(shotImg, shotRm);
        shotsContainer.appendChild(shotWrap);
      }
      attachBtn.style.display = shots.length >= MAX_SCREENSHOTS ? "none" : "";
      // Icon + label every time: the old branch replaced the whole button
      // with bare text once a shot was attached, so the camera vanished.
      attachBtn.textContent = "";
      const icon = h("span");
      icon.innerHTML = CAMERA_SVG;
      attachBtn.append(
        icon,
        h(
          "span",
          undefined,
          shots.length > 0 ? `Add more (${shots.length}/${MAX_SCREENSHOTS})` : "Screenshots",
        ),
      );
    }
    async function attachFile(file: Blob | null | undefined) {
      if (!file || !file.type.startsWith("image/")) return;
      if (shots.length >= MAX_SCREENSHOTS) {
        errEl.textContent = `Maximum ${MAX_SCREENSHOTS} screenshots`;
        return;
      }
      const dataUrl = await downscaleImage(file);
      if (dataUrl) {
        shots.push(dataUrl);
        renderShots();
      } else {
        errEl.textContent = "Could not attach that image — try a smaller one";
      }
    }
    async function attachFiles(files: FileList | null) {
      if (!files) return;
      for (let i = 0; i < files.length && shots.length < MAX_SCREENSHOTS; i++) {
        await attachFile(files[i]);
      }
    }
    fileInput.addEventListener("change", () => {
      void attachFiles(fileInput.files);
      fileInput.value = "";
    });
    // Paste a screenshot straight into the panel (desktop muscle memory).
    panel.addEventListener("paste", (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []).filter((i) =>
        i.type.startsWith("image/"),
      );
      if (items.length > 0) {
        e.preventDefault();
        for (const item of items) {
          void attachFile(item.getAsFile());
        }
      }
    });

    const row = h("div", "row");
    const sendBtn = h("button", "go", "Send");
    sendBtn.disabled = true;
    sendBtn.addEventListener("click", submit);
    const cancelBtn = h("button", "ghost", "Cancel");
    cancelBtn.addEventListener("click", closePanel);
    row.append(sendBtn, cancelBtn);

    const errEl = h("div", "err");
    const keys = h("div", "keys");
    keys.append(
      h("span", "mono", "Esc closes"),
      h("span", "sep", "·"),
      h("span", "mono", "Ctrl+Enter sends"),
    );

    panel.append(
      hdr,
      chips,
      hint,
      textarea,
      cnt,
      diagNote,
      contact,
      attachRow,
      shotsContainer,
      row,
      errEl,
      keys,
    );

    // ---- element-pick bar ----
    const pickbar = h("div", "pickbar");
    const pickMsg = h("span", "msg");
    const pickCount = h("span", "count");
    const pickLbl = h("span", "lbl");
    pickMsg.append(h("span", "dot"), pickCount, pickLbl);
    const pickDone = h("button", "go", "Done");
    pickDone.addEventListener("click", stopPicking);
    const pickCancel = h("button", "ghost", "Cancel");
    pickCancel.addEventListener("click", () => {
      clearSelection();
      scope = "page";
      stopPicking();
    });
    pickbar.append(pickMsg, pickDone, pickCancel);

    // ---- behaviors ----
    function syncChips() {
      for (const [key, chip] of chipEls) chip.classList.toggle("on", key === scope);
      hint.textContent =
        scope === "element"
          ? selected.length
            ? `${selected.length} element${selected.length > 1 ? "s" : ""} selected`
            : "Pick the element the feedback is about"
          : "";
      hint.style.display = hint.textContent ? "block" : "none";
    }

    function openPanel() {
      fab.style.display = "none";
      hdrPage.textContent = document.title || location.pathname;
      root.append(backdrop, panel);
      syncChips();
      document.addEventListener("keydown", onKeydown, true);
      textarea.focus();
    }

    function closePanel() {
      if (picking) stopPicking();
      // Abandon any in-flight recording. Closing the panel with the mic still
      // open would leave the browser's "recording" indicator lit on someone
      // else's site, which reads as the page still listening after the visitor
      // dismissed it — and would transcribe audio they chose not to send.
      voice?.cancel();
      clearSelection();
      backdrop.remove();
      panel.remove();
      document.removeEventListener("keydown", onKeydown, true);
      scope = "page";
      textarea.value = "";
      contact.value = "";
      shots = [];
      renderShots();
      cnt.textContent = `0/${MAX_LEN}`;
      diagnostics = null;
      syncDiagnostics();
      errEl.textContent = "";
      sendBtn.disabled = true;
      submitting = false;
      sendBtn.textContent = "Send";
      fab.style.display = "";
    }

    function onKeydown(e: KeyboardEvent) {
      // The panel is a modal overlay rendered in a shadow root. Host pages bind
      // global hotkeys (⌘K command palette, "/" search, "?" help, digit
      // shortcuts) on window/document. Because the event retargets to the shadow
      // HOST element when it crosses the boundary, the host's own
      // "is the user typing?" guard reads the wrong node and fires anyway —
      // stealing keystrokes while the user types feedback (observed on both
      // orangecat.ch and loki.orangecat.ch, which embed this same widget).
      // While the panel is open we own the keyboard: stop every keystroke at the
      // shadow boundary so nothing leaks to the host's global shortcuts. This is
      // standard modal keyboard-trap behaviour and is the single fix that covers
      // every embedding host at once.
      e.stopPropagation();
      if (e.key === "Escape") {
        if (picking) stopPicking();
        else closePanel();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        if (!sendBtn.disabled) void submit();
      }
    }

    // Full-viewport shield: blocks host navigation/handlers during pick.
    // Target resolution uses elementsFromPoint so we still hit the real DOM
    // under the shield (capture-only listeners on the host page were not
    // enough — some Next Link clicks still navigated mid-pick).
    const pickShield = h("div");
    pickShield.id = "fcw-pick-shield";
    pickShield.setAttribute("aria-hidden", "true");
    Object.assign(pickShield.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147482999",
      cursor: "crosshair",
      background: "transparent",
    } as CSSStyleDeclaration);

    function targetUnderPoint(x: number, y: number): Element | null {
      const stack = document.elementsFromPoint(x, y);
      for (const node of stack) {
        if (node === pickShield || node === host || host.contains(node)) continue;
        if (node instanceof Element) return resolvePickTarget(node);
      }
      return null;
    }

    function onPickMove(e: MouseEvent) {
      const target = targetUnderPoint(e.clientX, e.clientY);
      if (!target) return;
      if (hoverNode && hoverNode !== target) hoverNode.classList.remove("fcw-hover");
      hoverNode = target;
      target.classList.add("fcw-hover");
    }

    function onPickClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const target = targetUnderPoint(e.clientX, e.clientY);
      if (!target) return;
      const selector = generateSelector(target);
      const idx = selected.findIndex((s) => s.selector === selector);
      if (idx > -1) {
        selected.splice(idx, 1);
        selectedNodes[idx]?.classList.remove("fcw-selected");
        selectedNodes.splice(idx, 1);
      } else if (selected.length < MAX_ELEMENTS) {
        selected.push({
          elementType: target.tagName.toLowerCase(),
          elementText: elementLabel(target),
          selector,
        });
        selectedNodes.push(target);
        target.classList.add("fcw-selected");
      }
      syncPickbar();
    }

    function syncPickbar() {
      if (selected.length === 0) {
        pickCount.textContent = "Pick";
        pickLbl.textContent = "Click the element your feedback is about";
        pickDone.disabled = true;
        return;
      }
      const last = selected[selected.length - 1];
      // One label, ellipsised by CSS — the old bar concatenated every
      // selected element's text into a sentence that ran off the pill.
      const label = (last.elementText || last.selector).replace(/\s+/g, " ").slice(0, 60);
      pickCount.textContent = `${selected.length} selected`;
      pickLbl.textContent =
        selected.length === 1
          ? `${label} — click more, or Done`
          : `last: ${label} — Done when ready`;
      pickDone.disabled = false;
    }

    function startPicking() {
      if (picking) return;
      picking = true;
      document.head.appendChild(docStyle);
      backdrop.remove();
      panel.remove();
      // Shield lives in the shadow root under the pickbar so Done/Cancel stay
      // clickable; fixed positioning still covers the host page viewport.
      root.append(pickShield, pickbar);
      syncPickbar();
      pickShield.addEventListener("mousemove", onPickMove, true);
      pickShield.addEventListener("click", onPickClick, true);
      // Also swallow pointerdown so Next <Link> / button handlers never fire.
      pickShield.addEventListener(
        "pointerdown",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
        },
        true,
      );
    }

    function stopPicking() {
      if (!picking) return;
      picking = false;
      pickShield.removeEventListener("mousemove", onPickMove, true);
      pickShield.removeEventListener("click", onPickClick, true);
      pickShield.remove();
      hoverNode?.classList.remove("fcw-hover");
      hoverNode = null;
      pickbar.remove();
      root.append(backdrop, panel);
      if (scope === "element" && selected.length === 0) scope = "page";
      syncChips();
      textarea.focus();
    }

    function clearSelection() {
      for (const node of selectedNodes) node.classList.remove("fcw-selected");
      selected = [];
      selectedNodes = [];
      docStyle.remove();
    }

    function suggestionWithDiagnostics(): string {
      return buildSuggestion(textarea.value, diagnostics, MAX_LEN);
    }

    async function submit() {
      if (submitting || !textarea.value.trim()) return;
      submitting = true;
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending…";
      errEl.textContent = "";
      try {
        const res = await fetch(`${apiBase}/api/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            suggestion: suggestionWithDiagnostics(),
            // Every field here is clamped to the server's own cap. Two of them
            // were not, and the ingest route rejects the WHOLE submission with
            // a bare "Invalid submission" naming no field — so a visitor who
            // typed a long signature into "Name / email", or who was on a page
            // with a very long pathname, lost their entire report with no way
            // to know why. Caps: api/feedback/route.ts FeedbackBody.
            contact: contact.value.trim().slice(0, 200) || undefined,
            page: location.pathname.slice(0, 300),
            url: location.href.slice(0, 1000),
            pageTitle: document.title.slice(0, 300) || undefined,
            scope,
            screenshots: shots.length ? shots : undefined,
            selectedElements: selected.length ? selected : undefined,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        const body = (await res.json()) as { claimUrl?: string };
        showSuccess(body.claimUrl ?? null);
      } catch (err) {
        submitting = false;
        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
        errEl.textContent = err instanceof Error ? err.message : "Could not send, try again";
      }
    }

    function showSuccess(claimUrl: string | null) {
      panel.textContent = "";
      const ok = h("div", "ok");
      const tick = h("div", "tick", "✓");
      ok.append(
        tick,
        h("p", undefined, "Sent. Thank you."),
        h("div", "sub", "Track what happens next in Loki."),
      );
      if (claimUrl) {
        const track = h("a", "track", "Track this feedback →") as HTMLAnchorElement;
        track.href = claimUrl;
        track.target = "_blank";
        track.rel = "noopener noreferrer";
        ok.append(track);
      }
      panel.appendChild(ok);
      setTimeout(() => {
        // Keep the success view open while the tracking invitation is visible.
        // A visitor should never have to race a disappearing confirmation.
        if (claimUrl) return;
        closePanel();
        // Rebuild the form for the next open (success view replaced it).
        panel.textContent = "";
        panel.append(
          hdr,
          chips,
          hint,
          textarea,
          cnt,
          diagNote,
          contact,
          attachRow,
          shotsContainer,
          row,
          errEl,
          keys,
        );
      }, 2200);
    }

    // Programmatic entry point: open prefilled so "report this" is one click.
    // An already-open panel is left alone — the visitor may be mid-sentence,
    // and silently replacing their text would lose it.
    liveReport = (input: ReportInput) => {
      if (panel.isConnected) {
        textarea.focus();
        return;
      }
      openPanel();
      diagnostics = input.diagnostics ?? null;
      syncDiagnostics();
      if (input.message) {
        textarea.value = input.message.slice(0, MAX_LEN);
        cnt.textContent = `${textarea.value.length}/${MAX_LEN}`;
        sendBtn.disabled = !textarea.value.trim();
        // Caret at the end: the visitor adds detail, never clears boilerplate.
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    };
    // Only now can a click actually open something — see LokiApi.ready.
    api.ready = true;
    if (pendingReport) {
      const held = pendingReport;
      pendingReport = null;
      liveReport(held);
    }
  };

  // Boot gate — the server decides whether to render at all. This makes the
  // Loki token row a remote kill switch: pausing/revoking hides the FAB
  // on the customer site within the cache window, no deploy needed. It also
  // doubles as the heartbeat behind the setup UI's "Live" state. Fail closed:
  // if Loki is unreachable, submissions couldn't land anyway — don't
  // render a dead FAB.
  const boot = async () => {
    try {
      const res = await fetch(`${apiBase}/api/widget-boot?token=${encodeURIComponent(token)}`);
      const body = (await res.json()) as {
        active?: boolean;
        placement?: unknown;
        theme?: WidgetTheme;
      };
      if (body.active !== true) return;
      // Theme must come from boot — the widget has no fallback palette.
      // If boot doesn't provide colors, the widget doesn't render.
      if (!body.theme) return;
      const theme = body.theme;
      // Placement arrives with the render verdict, so the launcher paints once
      // in its final corner instead of appearing bottom-right and jumping.
      placement = normalizePlacement(body.placement);
      // The legacy data-fc-bottom attribute still wins where a customer set it:
      // their HTML is an explicit instruction from someone who looked at the
      // page, and silently overriding it would move a launcher they had already
      // positioned by hand.
      if (Number.isFinite(bottomOffset)) placement.offsetY = bottomOffset;
      // A visitor who dismissed the widget on this site gets no widget, without
      // a round trip to ask. Checked after boot so a revoked token still short-
      // circuits first — the operator's kill switch outranks the preference.
      if (isHiddenByVisitor(visitorOverride)) return;
      if (document.body) mount(theme);
      else document.addEventListener("DOMContentLoaded", () => mount(theme));
    } catch {
      return;
    }
  };
  void boot();
})();
