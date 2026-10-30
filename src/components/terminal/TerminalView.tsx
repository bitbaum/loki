"use client";

import { stripTerminalReports } from "@/lib/terminal-reports";
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ChevronDown,
  ChevronUp,
  Link2,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { AgentLifecycle } from "@/lib/agent-execution/types";
import { useTerminalFont, type TerminalFontControl } from "@/hooks/use-terminal-font";
import {
  TERMINAL_DESKTOP_FONT,
  TERMINAL_MOBILE_MAX_FONT,
  TERMINAL_TARGET_COLS,
  nextFontSizeForTarget,
  type PtyGeometry,
} from "@/lib/terminal-viewport";
import { createPtySizeSync, watchTerminalHost } from "@/lib/terminal-size-sync";
import { logicalLines } from "@/lib/terminal-screen";
import { attachTouchScroll } from "@/lib/terminal-touch-scroll";
import { usePressVerb } from "@/hooks/use-press-verb";
import type { TerminalTransport } from "./terminal-transport";

/**
 * Font sizing on a phone is a column-count problem wearing a typography mask.
 *
 * A 390px-wide device at the old fixed 13px measured ~44 columns. An 80-column
 * agent screen streamed into a 44-column grid is not "smaller", it is WRONG:
 * absolute cursor moves land in the wrong cell, wrapped rows overlay each other,
 * and the operator reads sentences that start halfway through a word. That is
 * the torn "irst. Telling it which repos you trust" seen on 2026-08-18.
 *
 * So the phone picks the largest font at which TERMINAL_TARGET_COLS still fits,
 * rather than the most readable font at any width. Small and correct beats
 * comfortable and lying — and the A−/A+ stepper hands the trade back to the
 * operator, who can spend columns on legibility whenever they only need to read.
 */
const MOBILE_QUERY = "(max-width: 767px)";

function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
}

const URL_RE = /https?:\/\/[^\s"'`<>\\)\]}]+/g;

/** Reconstruct whole URLs from the rendered terminal BUFFER (not the raw byte
 *  stream). TUI tools — ink, e.g. `claude setup-token` — HARD-wrap long URLs to
 *  the terminal width in their output, so the bytes split the URL across lines
 *  with no soft-wrap marker; scanning the stream yields only the first segment
 *  (the "link is cut off" bug). The grid is unambiguous though: a row whose
 *  trimmed text fills the full width continued onto the next row. Join those
 *  full-width runs back into logical lines, then match. Handles plainly-printed
 *  URLs (single short line) and width-wrapped ones alike. */
function extractUrlsFromBuffer(term: import("@xterm/xterm").Terminal): string[] {
  const urls = new Set<string>();
  for (const line of logicalLines(term.buffer.active, term.cols, 300)) {
    for (const u of line.match(URL_RE) ?? []) urls.add(u.replace(/[.,;:!?)\]}]+$/, ""));
  }
  return [...urls];
}

/** Real-DOM bar listing URLs detected in the terminal output — clickable + a
 *  one-click Copy each. Renders nothing until a URL appears, so it never steals
 *  terminal height. */
function LinkBar({ links, onDismiss }: { links: string[]; onDismiss: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  // Collapsed by default on phones. Four detected URLs render as four rows of
  // url + Copy + Open — ~190px measured, taken from a terminal that only had
  // ~300px to begin with. A link you might want later must not outrank the
  // session you are watching now.
  const [open, setOpen] = useState(false);
  if (links.length === 0) return null;
  const copy = (url: string) => {
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(url);
        window.setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
      })
      .catch(() => {});
  };
  return (
    <>
      <button
        type="button"
        className="ui-term-linkbar-toggle md:hidden"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
        {links.length} link{links.length === 1 ? "" : "s"}
        {open ? (
          <ChevronDown className="ml-auto h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronUp className="ml-auto h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      <div className={open ? "ui-term-linkbar" : "ui-term-linkbar hidden md:flex"}>
        <span className="ui-term-linkbar-label">Links</span>
        <div className="ui-term-linkbar-list">
          {links.map((url) => (
            <div key={url} className="ui-term-linkbar-row">
              <a
                className="ui-term-linkbar-url"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title={url}
              >
                {url}
              </a>
              <button type="button" className="ui-term-linkbar-btn" onClick={() => copy(url)}>
                {copied === url ? "Copied" : "Copy"}
              </button>
              <a
                className="ui-term-linkbar-btn"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open
              </a>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="ui-term-linkbar-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss links"
        >
          ✕
        </button>
      </div>
    </>
  );
}

/** Shown while the operator has scrolled back through the output: one tap
 *  returns to the bottom, where the agent is writing now. Without it, reading
 *  history on a phone meant swiping all the way back down by hand. */
function JumpToLive({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="ui-term-jump" onClick={onClick}>
      <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
      Live
    </button>
  );
}

/**
 * A swipe scrolls the output: xterm 6 only listens to the wheel, so without
 * this a phone could watch the terminal but never read back. A swipe past the
 * oldest kept line raises `setAtOldest` for five seconds.
 */
function attachSwipe(
  host: HTMLElement,
  term: import("@xterm/xterm").Terminal,
  setAtOldest: (on: boolean) => void,
): () => void {
  let timer = 0;
  const detach = attachTouchScroll(host, {
    scrollLines: (n) => term.scrollLines(n),
    cellHeight: () => {
      const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
      return screen && term.rows ? screen.clientHeight / term.rows : 0;
    },
    atTop: () => term.buffer.active.viewportY === 0,
    onTop: () => {
      setAtOldest(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAtOldest(false), 5000);
    },
  });
  return () => {
    window.clearTimeout(timer);
    detach();
  };
}

/**
 * A swipe for older output than the screen holds. The builder streams the
 * session from the moment you open it plus what it kept, not its whole life,
 * so a swipe at the top moved nothing and said nothing — read as "I'm not
 * able to scroll" (owner, 2026-10-19). Now it says where the rest is.
 */
function OldestKept({ onShowChat }: { onShowChat?: () => void }) {
  return (
    <div className="ui-term-oldest" role="status">
      <span>That is as far back as this screen goes.</span>
      {onShowChat && (
        <button type="button" className="ui-term-oldest-btn" onClick={onShowChat}>
          The whole conversation is in Chat
        </button>
      )}
    </div>
  );
}

/** Honest overlay for a connected-but-silent stream: the source said it was
 *  ready but never streamed the screen. Replaces the black "live" pane. */
function TerminalStalledOverlay({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="ui-card-shell-raised flex max-w-md flex-col items-center gap-2 px-4 py-3 text-center">
        <AlertTriangle className="h-5 w-5 text-status-warning" aria-hidden="true" />
        <p className="text-sm text-text-secondary">{message}</p>
      </div>
    </div>
  );
}

/**
 * Until the first live frame: what the pane is doing, in words. A phone used
 * to show a black pane for the seconds the runner takes to pick up the
 * request, then the terminal "a little bit later" (owner, 2026-10-18), with
 * nothing saying it was on its way. The server's remembered copy of the last
 * screen fills that gap when it has one, marked as not yet live.
 */
function TerminalOpening({ state }: { state: "waiting" | "cached" }) {
  // A 2px bar along the pane's top edge, not a pill: "Last screen ·
  // updating" floated over the output's first lines (owner, 2026-10-19). The
  // header says "Connecting…" meanwhile (onLive stays "connecting" until a
  // live frame), so the words are still on screen — just not on the screen.
  if (state === "cached") {
    return (
      <div className="ui-term-updating" role="status">
        <span className="sr-only">Last screen · updating</span>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4" role="status">
      <div className="ui-card-shell-raised flex max-w-xs flex-col items-center gap-2 px-4 py-3 text-center">
        <Loader2 className="ui-spinner h-5 w-5 text-text-muted" aria-hidden="true" />
        <p className="text-sm font-medium text-text-primary">Opening the screen…</p>
        <p className="text-xs text-text-tertiary">The runner sends it in a few seconds.</p>
      </div>
    </div>
  );
}

/** What sits over the screen: the stall warning, or the opening state and
 *  the jump back to live output. */
function PaneOverlay({
  stalled,
  stalledHint,
  opened,
  scrolledBack,
  jumpToLive,
  atOldest,
  onShowChat,
}: {
  stalled: boolean;
  stalledHint?: string;
  opened: OpenState;
  scrolledBack: boolean;
  jumpToLive: () => void;
  atOldest: boolean;
  onShowChat?: () => void;
}) {
  if (stalled)
    return (
      <TerminalStalledOverlay
        message={
          stalledHint ??
          "Connected, but no output arrived — the session may be unresponsive. Reopen it, or restart the executor."
        }
      />
    );
  return (
    <>
      {opened !== "live" && <TerminalOpening state={opened} />}
      {atOldest && <OldestKept onShowChat={onShowChat} />}
      {scrolledBack && <JumpToLive onClick={jumpToLive} />}
    </>
  );
}

/** Nothing drawn yet / the server's remembered screen / a live frame. */
type OpenState = "waiting" | "cached" | "live";

/**
 * The remembered screen paints, but it is not proof the session is live:
 * only a live frame clears the stall watchdog and the badge, and a later
 * remembered copy never marks a live pane as stale again.
 */
function openingTracker(setOpened: (s: OpenState) => void, markFramed: () => void) {
  let cached = false;
  let shown: OpenState = "waiting";
  return {
    onCached: (c: boolean) => {
      cached = c;
    },
    drew: () => {
      if (!cached) markFramed();
      const next = cached ? "cached" : "live";
      if (shown === "live" || next === shown) return;
      shown = next;
      setOpened(next);
    },
  };
}

/**
 * The ONE xterm view, parameterized by its transport (terminal-transport.ts).
 * Renders a workspace's / agent's byte stream, optionally captures keystrokes,
 * and keeps the PTY sized to the viewport. The substrate (server-owned PTY vs
 * Fleet Runner machine PTY) is entirely in the `transport` — this component is
 * substrate-agnostic.
 *
 * Two layouts:
 *  - `bare`: just the xterm host (the parent supplies its own header/status —
 *    e.g. TerminalLeaf). Use `className` to size it.
 *  - chrome (default): a connecting/live label, the terminal, and — when
 *    `onSend` is given — a gated single-line "Send a line" box.
 */
/** How long to wait after the stream connects (`ready`) before deciding the
 *  source is wedged. A healthy runner/executor always pushes an initial screen
 *  snapshot immediately on peek_start, so "connected but zero frames" past this
 *  window means the runner isn't actually serving — surface that instead of a
 *  black pane falsely labelled "live". */
const STALL_MS = 6000;

export function TerminalView({
  transport,
  interactive = false,
  onStatus,
  onSend,
  fill = false,
  bare = false,
  /** Minimal chrome for mobile full-screen — more rows for xterm. */
  compactChrome = false,
  /** Shown when the stream connects but no frames arrive (wedged runner). The
   *  caller knows the substrate (cloud vs this computer) so it supplies the
   *  actionable message; a generic default covers other callers. */
  stalledHint,
  font: fontProp,
  onLive,
  onGeometry,
  actions,
  readScreenRef,
  className,
  onActivate,
  autoFocus = false,
  onShowChat,
}: {
  transport: TerminalTransport;
  /** Where the whole conversation is, offered when a swipe runs out of
   *  terminal (the session's Chat view). */
  onShowChat?: () => void;
  /** A click or tap on a read-only screen: the person wants to type into it.
   *  The caller switches to typing (Type mode), so pressing the terminal does
   *  what everyone expects a terminal to do instead of nothing. */
  onActivate?: () => void;
  /** Take the keyboard as soon as an interactive screen mounts — set after
   *  `onActivate`, so the click that asked for typing ends in a cursor. */
  autoFocus?: boolean;
  /** Capture keystrokes (onData → transport.sendKey). The PTY is resized to
   *  this view either way — reading a session needs the right width too. */
  interactive?: boolean;
  /** Forward agent lifecycle (workspace substrate). */
  onStatus?: (status: AgentLifecycle) => void;
  /** Enables the gated single-line send box. */
  onSend?: (text: string) => Promise<void>;
  /** Fill the parent height (chrome layout only). */
  fill?: boolean;
  /** Render only the xterm host — no label, no send box. */
  bare?: boolean;
  compactChrome?: boolean;
  stalledHint?: string;
  /** Font size, owned by the caller so a control outside this component (the
   *  phone's session sheet) can drive it. Omitted → this view owns its own. */
  font?: TerminalFontControl;
  /** Stream state, for a caller rendering its own status indicator instead of
   *  the built-in status row (`bare`). */
  onLive?: (state: "connecting" | "live" | "stalled") => void;
  /** Live grid size, for a caller that reports columns elsewhere. */
  onGeometry?: (geometry: PtyGeometry) => void;
  /** Pane controls owned by the caller (the Loki-panel toggle, expand), shown
   *  at the end of the status row so the terminal keeps ONE row of chrome. */
  actions?: ReactNode;
  /** Filled with a reader of the rendered screen (logical lines, newest
   *  last) while this view is mounted — for the AI summary. */
  readScreenRef?: MutableRefObject<((rows: number) => string[]) | null>;
  /** Host div class (bare layout). */
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  // Connected (SSE `ready`) but no frame within STALL_MS → the source is wedged.
  const [stalled, setStalled] = useState(false);
  const [opened, setOpened] = useState<OpenState>("waiting");
  const [sendOpen, setSendOpen] = useState(false);
  const [line, setLine] = useState("");
  const [sending, setSending] = useState(false);
  // URLs detected in the terminal output stream — surfaced by <LinkBar/>.
  const [links, setLinks] = useState<string[]>([]);
  // The viewport is above the newest output (the operator scrolled back).
  const [scrolledBack, setScrolledBack] = useState(false);
  // A swipe asked for older output than is kept — said for a few seconds.
  const [atOldest, setAtOldest] = useState(false);
  // Live grid geometry, mirrored into React so the chrome can report it. The
  // operator is entitled to know how many columns they are actually reading —
  // it is the difference between "the agent wrote nonsense" and "my screen is
  // narrower than the screen this was drawn for".
  const [geometry, setGeometry] = useState<PtyGeometry | null>(null);
  // null = auto-fit to TERMINAL_TARGET_COLS. A number means the operator used
  // the stepper and their choice outranks the fit. Owned here only when the
  // caller does not own it (see the `font` prop) — the hook is called
  // unconditionally so the rules of hooks hold either way.
  const ownFont = useTerminalFont();
  const font = fontProp ?? ownFont;
  const fontOverride = font.size;
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const onActivateRef = useRef(onActivate);
  const autoFocusRef = useRef(autoFocus);
  useEffect(() => {
    onActivateRef.current = onActivate;
    autoFocusRef.current = autoFocus;
  });
  const press = usePressVerb();
  useEffect(() => {
    if (!readScreenRef) return;
    readScreenRef.current = (rows) => {
      const term = termRef.current;
      return term ? logicalLines(term.buffer.active, term.cols, rows) : [];
    };
    return () => {
      readScreenRef.current = null;
    };
  }, [readScreenRef]);
  /** Re-runs the mount effect's measure/fit/publish pass from outside it. */
  const resyncRef = useRef<(() => void) | null>(null);
  // Mirrored via effect (never written during render — see the refs rule);
  // declared before the mount effect below so the declaration-order effect run
  // seeds it before that effect's first read.
  const fontOverrideRef = useRef<number | null>(null);
  useEffect(() => {
    fontOverrideRef.current = fontOverride;
  });

  // Mirror the stream state and grid size out to a caller rendering its own
  // chrome. Effects rather than calls at the setState sites, so a parent that
  // re-renders on these never does so during this component's render.
  // The remembered screen is not live: until a live frame lands the caller's
  // dot and words say "connecting", not "live" over a stale picture.
  const liveState = stalled ? "stalled" : connected && opened !== "cached" ? "live" : "connecting";
  const onLiveRef = useRef(onLive);
  useEffect(() => {
    onLiveRef.current = onLive;
  });
  useEffect(() => {
    onLiveRef.current?.(liveState);
  }, [liveState]);
  const onGeometryRef = useRef(onGeometry);
  useEffect(() => {
    onGeometryRef.current = onGeometry;
  });
  useEffect(() => {
    if (geometry) onGeometryRef.current?.(geometry);
  }, [geometry]);

  // Keep the latest transport/onStatus without retearing the stream every render.
  const transportRef = useRef(transport);
  useEffect(() => {
    transportRef.current = transport;
  });
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Fresh substrate (tab switch) → back to "connecting…" until it proves live.
    setConnected(false);
    setStalled(false);
    setOpened("waiting");
    let disposed = false;
    let disconnect = () => {};
    let cleanupTerm = () => {};

    // Dynamic import keeps xterm out of the initial bundle — it loads only when
    // a terminal is actually opened.
    (async () => {
      const [{ Terminal }, { FitAddon }, { TERMINAL_THEME }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@/lib/terminal-theme"),
      ]);
      if (disposed) return;
      const transport = transportRef.current;

      // xterm draws into a canvas/WebGL context where CSS variables DON'T resolve,
      // so "var(--font-mono)" silently fell back to generic monospace — the "awful
      // font". Resolve the real family from CSS, and wait for the web font to load
      // first, or xterm measures the fallback glyph and mis-sizes every cell.
      await document.fonts.ready;
      if (disposed) return;
      const cssMono = getComputedStyle(document.documentElement)
        .getPropertyValue("--font-mono")
        .trim();
      const fontFamily = [
        cssMono,
        "ui-monospace",
        "SFMono-Regular",
        "Menlo",
        "Consolas",
        "monospace",
      ]
        .filter(Boolean)
        .join(", ");

      const mobile = isNarrowViewport();
      const term = new Terminal({
        convertEol: transport.convertEol,
        cursorBlink: interactive,
        // Read-only peeks keep stdin disabled so the view never swallows page input.
        disableStdin: !interactive,
        fontFamily,
        fontSize:
          fontOverrideRef.current ?? (mobile ? TERMINAL_MOBILE_MAX_FONT : TERMINAL_DESKTOP_FONT),
        lineHeight: 1.2,
        letterSpacing: 0,
        scrollback: 5000,
        theme: TERMINAL_THEME,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      termRef.current = term;
      // Clickable URLs that survive wrapping. The stock web-links addon detects
      // per visual row, so a URL wrapped across rows (ink TUIs hard-wrap to the
      // width) is clickable only on row 1 and opens a TRUNCATED link — the
      // "link is broken into pieces" bug. This provider reconstructs the whole
      // URL from the full-width row run, then highlights its cells on EVERY row
      // it spans; clicking any piece opens the complete link in a new tab.
      const linkProvider = term.registerLinkProvider({
        provideLinks(viewportY, callback) {
          const buf = term.buffer.active;
          const cols = term.cols;
          const absRow = buf.viewportY + (viewportY - 1);
          const lineLen = (i: number) => buf.getLine(i)?.translateToString(true).length ?? 0;
          // Span the logical line: a row that fills the full width continued below.
          let start = absRow;
          while (start > 0 && lineLen(start - 1) === cols) start--;
          let end = absRow;
          while (lineLen(end) === cols) end++;
          let logical = "";
          let rowOffset = -1;
          for (let i = start; i <= end; i++) {
            if (i === absRow) rowOffset = logical.length;
            logical += buf.getLine(i)?.translateToString(true) ?? "";
          }
          if (rowOffset < 0) {
            callback(undefined);
            return;
          }
          const rowLen = lineLen(absRow);
          const links: import("@xterm/xterm").ILink[] = [];
          for (const m of logical.matchAll(URL_RE)) {
            const url = m[0].replace(/[.,;:!?)\]}]+$/, "");
            const uStart = m.index ?? 0;
            const uEnd = uStart + url.length;
            // Intersect the URL's span with the cells this row contributes.
            const segStart = Math.max(uStart, rowOffset);
            const segEnd = Math.min(uEnd, rowOffset + rowLen);
            if (segStart >= segEnd) continue;
            links.push({
              text: url,
              range: {
                start: { x: segStart - rowOffset + 1, y: viewportY },
                end: { x: segEnd - rowOffset, y: viewportY },
              },
              decorations: { underline: true, pointerCursor: true },
              activate: () => window.open(url, "_blank", "noopener,noreferrer"),
            });
          }
          callback(links.length ? links : undefined);
        },
      });

      // Copy-on-select: the reliable fix for "copying is impossible". xterm's
      // selection lives in its own canvas layer (not the DOM), so the browser's
      // native ⌘C copies nothing. Mirror every non-empty selection straight to
      // the system clipboard the moment it's made (terminal "primary selection"
      // behaviour) — no keypress, no focus dance required.
      term.onSelectionChange(() => {
        const sel = term.getSelection();
        if (sel) navigator.clipboard?.writeText(sel).catch(() => {});
      });

      // Cross-platform copy/paste. The OS-standard paste — ⌘V (mac) / Ctrl-V
      // (Linux/Win) — is left to xterm's built-in paste handler: it reads
      // clipboardData on the browser's native paste event, no permission prompt,
      // and intercepting it here would DOUBLE-paste. We handle only the *terminal*
      // shortcuts the browser does NOT paste for: Ctrl-Shift-V / ⌘⇧V. Those get
      // an explicit preventDefault() so that even if a browser does emit a native
      // paste for the combo, exactly one paste runs.
      //   Copy: ⌘C / Ctrl-Shift-C with a selection (plain Ctrl-C stays SIGINT, so
      //   interrupting an agent still works); copy-on-select already covers the
      //   common case above.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true;
        const key = e.key.toLowerCase();
        const isCopy = (e.metaKey && key === "c") || (e.ctrlKey && e.shiftKey && key === "c");
        if (isCopy && term.hasSelection()) {
          navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
          return false; // handled — don't forward to the PTY
        }
        const isShiftPaste = e.shiftKey && (e.ctrlKey || e.metaKey) && key === "v";
        if (isShiftPaste && interactive) {
          e.preventDefault(); // guarantee a single paste even if the browser also pastes
          navigator.clipboard
            ?.readText()
            .then((t) => {
              if (t) void transport.sendKey(t);
            })
            .catch(() => {});
          return false;
        }
        return true;
      });

      term.open(host);
      const detachTouch = attachSwipe(host, term, setAtOldest);
      const syncScrolledBack = () => {
        const buf = term.buffer.active;
        setScrolledBack(buf.viewportY < buf.baseY);
      };
      const scrollDisposable = term.onScroll(syncScrolledBack);
      const writeDisposable = term.onWriteParsed(syncScrolledBack);
      if (interactive) {
        host.tabIndex = 0;
        host.addEventListener("mousedown", () => {
          term.focus();
        });
        if (autoFocusRef.current) term.focus();
      }
      // Read-only screen: a click or tap means "let me type here". Selecting
      // text to copy also ends in a click, so a selection is left alone; a
      // touch scroll never becomes a click at all.
      const activate = () => {
        if (term.hasSelection()) return;
        onActivateRef.current?.();
      };
      if (!interactive) host.addEventListener("click", activate);
      // Debug/automation handle: reach the live xterm instance from devtools or
      // an e2e harness (e.g. to assert copy/paste wiring) via
      // `document.querySelector('.xterm')._fcTerm`. Harmless in prod.
      if (term.element) (term.element as HTMLElement & { _fcTerm?: unknown })._fcTerm = term;
      // Default (DOM) renderer on purpose: it draws glyphs with the browser's
      // native font engine, so text is crisp + identical to the rest of the page.
      // WebGL is faster but rasterizes to a texture atlas that can blur text on
      // fractional-DPR displays — wrong trade for a readability-first terminal.
      try {
        fit.fit();
      } catch {
        /* host not laid out yet */
      }

      // Serialize keystrokes through a single in-flight send chain so bytes never
      // race out of order under fast typing (the bug the server terminal had:
      // "echo" rendering as "ehco"). Bursts coalesce into fewer requests too.
      let inputBuffer = "";
      let flushing = false;
      const flushInput = async () => {
        if (flushing) return;
        flushing = true;
        try {
          while (inputBuffer) {
            const data = inputBuffer;
            inputBuffer = "";
            await transport.sendKey(data);
          }
        } finally {
          flushing = false;
        }
      };
      const inputDisposable = interactive
        ? term.onData((data) => {
            inputBuffer += stripTerminalReports(data); // query answers are not keys
            void flushInput();
          })
        : null;

      /**
       * Shrink the font until TERMINAL_TARGET_COLS fits, or the floor is hit.
       *
       * Columns scale as 1/fontSize, so one estimate lands within a step or two
       * of the answer and the walk finishes it — cheaper than stepping down from
       * 13px one pixel at a time, since every attempt costs a real fit() reflow.
       * Skipped entirely when the operator has set a size: their choice is the
       * point of the stepper.
       */
      const fitFontToTarget = () => {
        if (fontOverrideRef.current !== null || !isNarrowViewport()) {
          try {
            fit.fit();
          } catch {
            /* not laid out yet */
          }
          return;
        }
        let size = TERMINAL_MOBILE_MAX_FONT;
        term.options.fontSize = size;
        try {
          fit.fit();
        } catch {
          return;
        }
        // nextFontSizeForTarget owns the arithmetic (and the "always make
        // progress" guarantee); this loop only applies and re-measures. The
        // bound is belt-and-braces against a host whose width changes under us.
        for (let attempt = 0; attempt < 8; attempt++) {
          const next = nextFontSizeForTarget(size, term.cols);
          if (next === null) return;
          size = next;
          term.options.fontSize = size;
          try {
            fit.fit();
          } catch {
            return;
          }
        }
      };

      // Fit on mount and on every host resize, and publish the result to the
      // PTY so the program on the other end re-wraps to what is on screen.
      // Deliberately NOT gated on `interactive`: a viewer without live keystrokes
      // captures no keystrokes but still reads the session, and gating the
      // publish on keystroke capture is what left a 79-column grid drawing a
      // 120-column PTY (see terminal-size-sync.ts). The floor for what a viewer
      // may publish lives in ptyResizeToPublish. A pane that still fits fewer
      // than TERMINAL_MIN_COLS (a split, or A+ on a narrow window) is PINNED up
      // to the floor and publishes that — the host scrolls sideways — because a
      // grid narrower than the PTY it shows wraps every row mid-token.
      const sizes = createPtySizeSync({
        fit: fitFontToTarget,
        measure: () => ({ cols: term.cols, rows: term.rows }),
        pin: (cols, rows) => term.resize(cols, rows),
        publish: (cols, rows) => transport.sendResize(cols, rows),
        onGeometry: setGeometry,
      });
      resyncRef.current = sizes.sync;
      const unwatchHost = watchTerminalHost(host, sizes);

      // Scan the rendered buffer for URLs (newest first, capped) and surface them
      // in <LinkBar/>. Debounced: run once output settles, after xterm has laid
      // the bytes into the grid — only then can full-width rows be joined back
      // into whole URLs. Kept after the URL leaves the screen on a TUI redraw.
      let scanTimer = 0;
      const scheduleScan = () => {
        if (scanTimer) return;
        scanTimer = window.setTimeout(() => {
          scanTimer = 0;
          const urls = extractUrlsFromBuffer(term);
          if (urls.length) {
            setLinks((prev) => {
              const next = [...prev];
              for (const u of urls) if (!next.includes(u)) next.unshift(u);
              return next.length === prev.length ? prev : next.slice(0, 4);
            });
          }
        }, 150);
      };
      // Stall watchdog: arm on connect, disarm on the first frame. If it fires,
      // the stream said "ready" but the runner never streamed the screen —
      // an honest "not responding" beats a black pane labelled "live".
      let framed = false;
      let stallTimer = 0;
      const clearStallTimer = () => {
        if (stallTimer) {
          window.clearTimeout(stallTimer);
          stallTimer = 0;
        }
      };
      const armStall = () => {
        if (framed) return;
        clearStallTimer();
        stallTimer = window.setTimeout(() => {
          if (!framed) setStalled(true);
        }, STALL_MS);
      };
      const markFramed = () => {
        framed = true;
        clearStallTimer();
        setStalled(false);
      };
      const opening = openingTracker(setOpened, markFramed);
      disconnect = transport.connect({
        onCached: opening.onCached,
        onOutput: (data) => {
          opening.drew();
          term.write(data);
          scheduleScan();
        },
        onReset: () => {
          opening.drew();
          term.reset();
          setLinks([]);
        },
        onStatus: (status) => onStatusRef.current?.(status),
        onConnected: (c) => {
          setConnected(c);
          if (c) armStall();
          else {
            clearStallTimer();
            setStalled(false);
          }
        },
      });

      cleanupTerm = () => {
        termRef.current = null;
        resyncRef.current = null;
        if (scanTimer) window.clearTimeout(scanTimer);
        clearStallTimer();
        linkProvider.dispose();
        detachTouch();
        scrollDisposable.dispose();
        writeDisposable.dispose();
        unwatchHost();
        inputDisposable?.dispose();
        host.removeEventListener("click", activate);
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      disconnect();
      cleanupTerm();
    };
    // Re-run only when the substrate identity or interactivity changes; the
    // transport object itself is read through transportRef inside the effect.
  }, [transport.key, interactive]);

  // Apply an operator-chosen size to the live terminal without tearing down the
  // stream, then re-fit and publish: a font step changes the column count, and
  // the PTY has to hear about it like any other resize. Clearing the choice
  // hands the grid back to the auto-fit.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (fontOverride !== null) term.options.fontSize = fontOverride;
    resyncRef.current?.();
  }, [fontOverride]);

  // Tell the font owner what is actually on screen, so a step taken while in
  // auto mode starts from the size the eye is reading rather than from the
  // theoretical maximum. Auto-fit picks the size inside the effect above; only
  // the terminal knows where it landed.
  const fontSync = font.sync;
  useEffect(() => {
    const rendered = termRef.current?.options.fontSize;
    if (rendered) fontSync(rendered);
  }, [geometry, fontSync]);

  const jumpToLive = () => termRef.current?.scrollToBottom();
  const paneOverlay = (
    <PaneOverlay
      {...{ stalled, stalledHint, opened, scrolledBack, jumpToLive, atOldest, onShowChat }}
    />
  );

  if (bare) {
    return (
      <div className={`flex flex-col ${className ?? "h-full w-full"}`}>
        <div className="relative min-h-0 flex-1">
          <div ref={hostRef} className="ui-term-host" />
          {paneOverlay}
        </div>
        <LinkBar links={links} onDismiss={() => setLinks([])} />
      </div>
    );
  }

  const send = async () => {
    const text = line.trim();
    if (!text || !onSend) return;
    setSending(true);
    try {
      await onSend(text);
      setLine("");
    } finally {
      setSending(false);
    }
  };

  const statusLabel = stalled
    ? "not responding"
    : opened === "cached"
      ? "last screen · updating…"
      : connected
        ? interactive
          ? `live · ${press.verb} to focus, type directly`
          : onActivate
            ? `live · ${press.verb} the screen to type`
            : "live"
        : "connecting…";
  // Below the target the grid is narrower than the screen the agent drew, so
  // wide output WILL wrap oddly. Saying which is which costs one chip and turns
  // "the agent is broken" back into "my phone is 390px wide".
  const belowTarget = Boolean(geometry && geometry.cols < TERMINAL_TARGET_COLS);

  return (
    <div className={`flex flex-col gap-2 ${fill ? "h-full min-h-0" : ""}`}>
      {/* Desktop only. On a phone this row is duplicated by chrome that reads
          better: the live dot sits in the header next to the session name, and
          the size stepper is in the session sheet. Two status lines saying the
          same thing is exactly the kind of stacking that left the phone with
          four visible terminal rows. */}
      <div className="ui-term-statusrow hidden md:flex">
        <span className={`ui-micro-label ${stalled ? "text-status-warning" : ""}`}>
          {statusLabel}
        </span>
        {geometry && geometry.cols > 0 && (
          <span
            className={belowTarget ? "ui-term-cols ui-term-cols-warn" : "ui-term-cols"}
            title={
              belowTarget
                ? `${geometry.cols} columns — this screen is narrower than the ${TERMINAL_TARGET_COLS} an agent TUI draws for, so wide output may wrap. Use − for more columns.`
                : `${geometry.cols}×${geometry.rows} — wide enough for standard agent output.`
            }
          >
            {geometry.cols}c
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="ui-term-font-btn"
            onClick={() => font.step(-1)}
            aria-label="Smaller text, more columns"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ui-term-font-btn"
            onClick={() => font.step(1)}
            aria-label="Larger text, fewer columns"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {fontOverride !== null && (
            <button type="button" className="ui-term-font-reset" onClick={font.reset}>
              Auto
            </button>
          )}
          {onSend && !interactive && (
            <button
              type="button"
              className={compactChrome ? "ui-btn-xs min-h-11" : "ui-btn-xs"}
              onClick={() => setSendOpen((v) => !v)}
            >
              {sendOpen ? "Cancel" : "Send a line"}
            </button>
          )}
          {actions}
        </div>
      </div>
      <div
        className={`relative w-full overflow-hidden rounded-md bg-surface-terminal ${fill ? "min-h-0 flex-1" : compactChrome ? "min-h-0 flex-1" : "h-72"}`}
      >
        <div ref={hostRef} className="ui-term-host" />
        {paneOverlay}
      </div>
      <LinkBar links={links} onDismiss={() => setLinks([])} />
      {onSend && !interactive && sendOpen && (
        <div className="flex items-center gap-2">
          <input
            className="ui-input-compact flex-1"
            value={line}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
            placeholder="Type a line to send into the terminal…"
            autoFocus
          />
          <button
            type="button"
            className="ui-btn-primary ui-btn-xs"
            onClick={() => void send()}
            disabled={sending || !line.trim()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}
