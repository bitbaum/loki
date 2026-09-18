"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Link2, Minus, Plus } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { AgentLifecycle } from "@/lib/agent-execution/types";
import { useTerminalFont, type TerminalFontControl } from "@/hooks/use-terminal-font";
import {
  TERMINAL_DESKTOP_FONT,
  TERMINAL_MOBILE_MAX_FONT,
  TERMINAL_TARGET_COLS,
  nextFontSizeForTarget,
  ptyResizeToPublish,
  type PtyGeometry,
} from "@/lib/terminal-viewport";
import type { TerminalTransport } from "./terminal-transport";
import { looksLikeAgentCapacityIssue } from "@/lib/agent-resolution";
import { TerminalCapacityBanner, type AgentAvailability } from "./TerminalCapacityBanner";

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

/** Detect capacity issue language in terminal buffer text. */
function detectCapacityInBuffer(term: import("@xterm/xterm").Terminal): {
  detected: boolean;
  resetsAt?: string;
} {
  const buf = term.buffer.active;
  // Scan the recent terminal output (last 100 lines) for capacity language.
  const start = Math.max(0, buf.length - 100);
  let text = "";
  for (let i = start; i < buf.length; i++) {
    text += buf.getLine(i)?.translateToString(true) ?? "";
    text += "\n";
  }

  const detected = looksLikeAgentCapacityIssue(text);
  if (!detected) return { detected: false };

  // Try to extract reset time from messages like "resets 1pm (Europe/Zurich)"
  const resetMatch = text.match(/resets?\s+([^\n]+?)(?:\n|$)/i);
  const resetsAt = resetMatch?.[1]?.trim();

  return { detected: true, resetsAt };
}

/** Reconstruct whole URLs from the rendered terminal BUFFER (not the raw byte
 *  stream). TUI tools — ink, e.g. `claude setup-token` — HARD-wrap long URLs to
 *  the terminal width in their output, so the bytes split the URL across lines
 *  with no soft-wrap marker; scanning the stream yields only the first segment
 *  (the "link is cut off" bug). The grid is unambiguous though: a row whose
 *  trimmed text fills the full width continued onto the next row. Join those
 *  full-width runs back into logical lines, then match. Handles plainly-printed
 *  URLs (single short line) and width-wrapped ones alike. */
function extractUrlsFromBuffer(term: import("@xterm/xterm").Terminal): string[] {
  const buf = term.buffer.active;
  const cols = term.cols;
  const urls = new Set<string>();
  let logical = "";
  const flush = () => {
    for (const u of logical.match(URL_RE) ?? []) urls.add(u.replace(/[.,;:!?)\]}]+$/, ""));
    logical = "";
  };
  // Scan a bounded recent window; back up to a logical-line boundary so a URL
  // that began just above the window isn't captured truncated.
  let start = Math.max(0, buf.length - 300);
  while (start > 0 && (buf.getLine(start - 1)?.translateToString(true).length ?? 0) === cols)
    start--;
  for (let i = start; i < buf.length; i++) {
    const text = buf.getLine(i)?.translateToString(true) ?? "";
    logical += text;
    if (text.length < cols) flush(); // row didn't fill the width → logical line ended
  }
  flush();
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
  className,
  currentAgent,
  availableAgents,
  onSwitchAgent,
  switchingAgent = false,
}: {
  transport: TerminalTransport;
  /** Capture keystrokes (onData → transport.sendKey) and keep the PTY resized. */
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
  /** Host div class (bare layout). */
  className?: string;
  currentAgent?: string | null;
  availableAgents?: AgentAvailability[];
  onSwitchAgent?: (agent: string) => void;
  switchingAgent?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  // Connected (SSE `ready`) but no frame within STALL_MS → the source is wedged.
  const [stalled, setStalled] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [line, setLine] = useState("");
  const [sending, setSending] = useState(false);
  // URLs detected in the terminal output stream — surfaced by <LinkBar/>.
  const [links, setLinks] = useState<string[]>([]);
  // Live grid geometry, mirrored into React so the chrome can report it. The
  // operator is entitled to know how many columns they are actually reading —
  // it is the difference between "the agent wrote nonsense" and "my screen is
  // narrower than the screen this was drawn for".
  const [geometry, setGeometry] = useState<PtyGeometry | null>(null);
  // Capacity detection — scanned from the terminal buffer.
  const [capacityState, setCapacityState] = useState<{
    detected: boolean;
    resetsAt?: string;
  }>({ detected: false });
  // null = auto-fit to TERMINAL_TARGET_COLS. A number means the operator used
  // the stepper and their choice outranks the fit. Owned here only when the
  // caller does not own it (see the `font` prop) — the hook is called
  // unconditionally so the rules of hooks hold either way.
  const ownFont = useTerminalFont();
  const font = fontProp ?? ownFont;
  const fontOverride = font.size;
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
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
  const liveState = stalled ? "stalled" : connected ? "live" : "connecting";
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

  const stallMessage =
    stalledHint ??
    "Connected, but no output arrived — the session may be unresponsive. Reopen it, or restart the executor.";

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
      fitRef.current = fit;
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
      if (interactive) {
        host.tabIndex = 0;
        host.addEventListener("mousedown", () => {
          term.focus();
        });
      }
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
            inputBuffer += data;
            void flushInput();
          })
        : null;

      // ResizeObserver tracks both viewport and container changes — keeps the
      // remote PTY (interactive substrates) sized to what the viewer sees.
      // Filtered through ptyResizeToPublish: a collapsed host measures 1 row,
      // and publishing that reflows the real session an agent is working in.
      let lastPublished: PtyGeometry | null = null;

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

      const syncSize = () => {
        fitFontToTarget();
        setGeometry({ cols: term.cols, rows: term.rows });
        if (!interactive) return;
        // A narrow viewer adapts ITSELF (font above) rather than reflowing the
        // session — see the note on TERMINAL_MIN_COLS. ptyResizeToPublish is the
        // enforcement point; this returns null below the floor, so a phone that
        // cannot reach 60 columns simply never speaks.
        const next = ptyResizeToPublish({ cols: term.cols, rows: term.rows }, lastPublished);
        if (!next) return;
        lastPublished = next;
        transport.sendResize(next.cols, next.rows);
      };
      const resizeObserver = new ResizeObserver(syncSize);
      resizeObserver.observe(host);
      resyncRef.current = syncSize;
      syncSize();

      // Scan the rendered buffer for URLs (newest first, capped) and surface them
      // in <LinkBar/>. Also scan for capacity issues — debounced to run once output
      // settles, after xterm has laid the bytes into the grid.
      let scanTimer = 0;
      const scheduleScan = () => {
        if (scanTimer) return;
        // Reduced from 150ms to 50ms for faster capacity detection. The overlay
        // needs to appear quickly to replace the vendor error text.
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
          // Also scan for capacity issues in the buffer.
          const capacity = detectCapacityInBuffer(term);
          setCapacityState(capacity);
        }, 50);
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
      disconnect = transport.connect({
        onOutput: (data) => {
          markFramed();
          term.write(data);
          scheduleScan();
        },
        onReset: () => {
          markFramed();
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
        fitRef.current = null;
        resyncRef.current = null;
        if (scanTimer) window.clearTimeout(scanTimer);
        clearStallTimer();
        linkProvider.dispose();
        resizeObserver.disconnect();
        inputDisposable?.dispose();
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
  // stream. Clearing the choice hands the grid back to the auto-fit.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    if (fontOverride === null) {
      resyncRef.current?.();
      return;
    }
    term.options.fontSize = fontOverride;
    try {
      fit.fit();
    } catch {
      /* not laid out yet */
    }
    setGeometry({ cols: term.cols, rows: term.rows });
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

  // Capacity banner takes precedence over stalled overlay — a capacity wall is
  // a known, actionable state; stalled is "maybe wedged, maybe just slow".
  const showCapacity =
    capacityState.detected &&
    currentAgent &&
    availableAgents &&
    availableAgents.length > 0 &&
    onSwitchAgent;

  if (bare) {
    return (
      <div className={`flex flex-col ${className ?? "h-full w-full"}`}>
        <div className="relative min-h-0 flex-1">
          <div ref={hostRef} className="h-full w-full" />
          {showCapacity && (
            <TerminalCapacityBanner
              currentAgent={currentAgent}
              agents={availableAgents}
              resetsAt={capacityState.resetsAt}
              onSwitch={onSwitchAgent}
              switching={switchingAgent}
            />
          )}
          {!showCapacity && stalled && <TerminalStalledOverlay message={stallMessage} />}
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
    : connected
      ? interactive
        ? "live · click to focus, type directly"
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
                ? `${geometry.cols} columns — this screen is narrower than the ${TERMINAL_TARGET_COLS} an agent TUI draws for, so wide output may wrap. Tap A− for more columns.`
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
        </div>
      </div>
      <div
        className={`relative w-full overflow-hidden rounded-md bg-surface-terminal ${fill ? "min-h-0 flex-1" : compactChrome ? "min-h-0 flex-1" : "h-72"}`}
      >
        <div ref={hostRef} className="h-full w-full" />
        {showCapacity && (
          <TerminalCapacityBanner
            currentAgent={currentAgent}
            agents={availableAgents}
            resetsAt={capacityState.resetsAt}
            onSwitch={onSwitchAgent}
            switching={switchingAgent}
          />
        )}
        {!showCapacity && stalled && <TerminalStalledOverlay message={stallMessage} />}
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
