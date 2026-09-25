/**
 * Geometry rules for the one place a *viewer* can change the *source of truth*:
 * the browser terminal mirrors its own size onto the real PTY, so whatever the
 * window is doing gets typed into the session an agent is actually working in.
 *
 * Observed on prod 2026-08-15: opening /terminal in a short browser window
 * posted `{kind:"resize", tab:"Tab #1", cols:74, rows:1}` — twice — and the
 * runner applied it to the live zellij tab. A collapsed container (mid-mount,
 * a hidden panel, a phone with the keyboard up) is indistinguishable from an
 * intentional size once it has left the browser, and reflowing a running TUI to
 * one row loses its screen.
 *
 * So the invariant is: **a viewer may follow the session's size, never shrink
 * it below usability.** Two enforcement points, and they are different on
 * purpose — the client knows what it sent last and can stay silent; the server
 * knows nothing about the caller and can only floor what arrives.
 */

/**
 * The width every agent TUI is built to lay out in. Not a preference: `claude`,
 * `codex` and friends compose boxes, tables and wrapped prose against roughly
 * this, and zellij's own status line assumes it. A viewer that renders fewer
 * columns than the session was drawn for shows torn output — words beginning
 * mid-syllable, box borders landing inside text — which is exactly what a phone
 * showed before this constant existed.
 */
export const TERMINAL_TARGET_COLS = 80;

/**
 * Below any real viewport, above the garbage a collapsed container produces.
 * A mounting or hidden host measures 1 column.
 *
 * Raised 40 → 60 on 2026-08-18. 40 was chosen as "a 320px phone still measures
 * ~45 cols", which quietly made the phone's mangled 44-column view the SESSION's
 * size: the resize was published, the runner applied it, and a laptop coming
 * back to that tab found the agent's screen reflowed to 44 columns. No TUI lays
 * out usefully there. Under 60 the viewer now stays silent and adapts its own
 * font instead (see TerminalView), so a phone changes what IT shows, never what
 * the session is.
 */
export const TERMINAL_MIN_COLS = 60;
export const TERMINAL_MIN_ROWS = 6;

export type PtyGeometry = { cols: number; rows: number };

/**
 * Client side: what (if anything) this measurement should publish to the PTY.
 *
 * `null` means stay silent — either the host is not laid out (degenerate), or
 * nothing changed. The second case matters as much as the first: ResizeObserver
 * fires on every layout pass, and each duplicate was a real POST that woke the
 * runner to re-apply a size it already had.
 */
export function ptyResizeToPublish(
  measured: PtyGeometry,
  lastPublished: PtyGeometry | null,
): PtyGeometry | null {
  const { cols, rows } = measured;
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
  if (cols < TERMINAL_MIN_COLS || rows < TERMINAL_MIN_ROWS) return null;
  if (lastPublished && lastPublished.cols === cols && lastPublished.rows === rows) return null;
  return { cols, rows };
}

/**
 * Below this a host is not laid out (mid-mount, a hidden panel, a pane being
 * dragged shut) rather than genuinely narrow: nothing a person reads from is
 * 20 columns wide. Such a measurement stays silent AND leaves the grid alone.
 */
export const TERMINAL_COLLAPSED_COLS = 20;

/**
 * The grid a viewer must actually draw so that it matches the PTY it drives.
 *
 * Observed on prod 2026-09-25: a cloud `claude` tab in a 46-column pane (41
 * after A+). ptyResizeToPublish stays silent under TERMINAL_MIN_COLS — rightly,
 * a narrow viewer must not squash the session — but the grid stayed 46 wide
 * while the PTY kept its spawn size of 120, so every row wrapped mid-token and
 * the right-aligned status line piled up down the edge. The floor protected the
 * session and left the one person looking at it reading garbage.
 *
 * The floor is not negotiable, so the GRID gives: a real-but-narrow host is
 * pinned up to TERMINAL_MIN_COLS (the host scrolls sideways) and that is the
 * size published — the same size the server's clampPtyGeometry would impose
 * anyway. Grid and PTY then agree by construction. A collapsed host returns
 * null: publish nothing, pin nothing.
 */
export function gridForSession(measured: PtyGeometry): PtyGeometry | null {
  const { cols, rows } = measured;
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
  if (cols < TERMINAL_COLLAPSED_COLS || rows < TERMINAL_MIN_ROWS) return null;
  return { cols: Math.max(cols, TERMINAL_MIN_COLS), rows };
}

/**
 * Server side: floor whatever arrived. A caller that is not this app's terminal
 * (an old bundle, the desktop runner, a script) still cannot squash the tab.
 */
export function clampPtyGeometry({ cols, rows }: PtyGeometry): PtyGeometry & { clamped: boolean } {
  const next = {
    cols: Math.max(cols, TERMINAL_MIN_COLS),
    rows: Math.max(rows, TERMINAL_MIN_ROWS),
  };
  return { ...next, clamped: next.cols !== cols || next.rows !== rows };
}

// ── Which session a viewer is attached to ────────────────────────────────────

export type TabAttachment = {
  /** The tab whose bytes should stream, or null when nothing may be attached. */
  activeTab: string | null;
  /** True once we know the requested tab is not on this builder. */
  deepLinkMiss: boolean;
};

/**
 * Resolve a ?tab= deep link against the sessions a builder actually reports.
 *
 * The rule this encodes is a safety rule, not a layout one. The previous
 * behaviour fell through to `tabs[0]` whenever the requested tab was absent and
 * printed a one-line warning above the terminal. Observed on a phone
 * 2026-08-18: a Loki link for `orangecat` attached to `sbb-lost-found` while
 * the input bar underneath promised "keystrokes go straight to the session" —
 * so every keystroke, Ctrl-C included, was aimed at an unrelated agent by a
 * page that looked like it had done what was asked.
 *
 * A miss therefore attaches to NOTHING until the operator chooses. Note the
 * `selected === requestedTab` guard: once they pick, `selected` moves off the
 * requested name and normal resolution resumes, so the miss state cannot trap
 * them. And while `loading` is true the miss is not yet reported — an empty tab
 * list mid-fetch is not evidence the session is gone.
 */
export function resolveTabAttachment({
  requestedTab,
  selected,
  tabs,
  loading,
}: {
  requestedTab: string | null | undefined;
  selected: string | null;
  tabs: string[];
  loading: boolean;
}): TabAttachment {
  const pending =
    Boolean(requestedTab) && selected === requestedTab && !tabs.includes(requestedTab!);
  if (pending) return { activeTab: null, deepLinkMiss: !loading };
  const activeTab = selected && tabs.includes(selected) ? selected : (tabs[0] ?? null);
  return { activeTab, deepLinkMiss: false };
}

// ── Fitting a phone to an 80-column screen ───────────────────────────────────

/** Largest font a phone starts from, and the floor it will not go below. */
export const TERMINAL_MOBILE_MAX_FONT = 13;
export const TERMINAL_MOBILE_MIN_FONT = 7;
export const TERMINAL_DESKTOP_FONT = 14;

/**
 * Next font size to try when `cols` columns fit at `size` but the target needs
 * more. Returns null when the current size is already good enough, or when the
 * floor has been reached and no smaller size is available.
 *
 * Columns are inversely proportional to font size, so one division lands close
 * and the caller's ±1 walk finishes the job. This matters because every attempt
 * costs a real xterm reflow: stepping 13→12→11→10→9→8 is six of them, and this
 * gets to the same answer in two.
 */
export function nextFontSizeForTarget(
  size: number,
  cols: number,
  targetCols: number = TERMINAL_TARGET_COLS,
  minFont: number = TERMINAL_MOBILE_MIN_FONT,
): number | null {
  if (!Number.isFinite(cols) || cols <= 0) return null; // host not laid out
  if (cols >= targetCols) return null;
  if (size <= minFont) return null;
  const estimate = Math.max(minFont, Math.floor((size * cols) / targetCols));
  // The estimate can round back to the current size on a near miss; step down
  // by one there so the walk always makes progress and cannot spin.
  return estimate < size ? estimate : size - 1;
}
