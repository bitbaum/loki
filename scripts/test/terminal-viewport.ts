// The browser terminal is the one surface where a VIEWER resizes the SOURCE OF
// TRUTH — its measurements are applied to the live PTY an agent is working in.
// These cases pin the rule that a collapsed or transient viewport can never
// shrink that session (src/lib/terminal-viewport.ts).
// Run: npx tsx scripts/test/terminal-viewport.ts
import {
  ptyResizeToPublish,
  gridForSession,
  TERMINAL_COLLAPSED_COLS,
  clampPtyGeometry,
  resolveTabAttachment,
  nextFontSizeForTarget,
  TERMINAL_TARGET_COLS,
  TERMINAL_MOBILE_MAX_FONT,
  TERMINAL_MOBILE_MIN_FONT,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
} from "@/lib/terminal-viewport";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${label}: expected ${e}, got ${a}`);
  }
}
function check(label: string, condition: boolean) {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

// --- what the viewer publishes ------------------------------------------------

// The observed prod payload: a short browser window measured one row, and the
// runner applied it to the real zellij tab.
eq(ptyResizeToPublish({ cols: 74, rows: 1 }, null), null, "1-row measurement is never published");
eq(ptyResizeToPublish({ cols: 8, rows: 20 }, null), null, "hair-thin width is never published");
eq(ptyResizeToPublish({ cols: 0, rows: 0 }, null), null, "unlaid-out host is never published");
eq(ptyResizeToPublish({ cols: NaN, rows: NaN }, null), null, "NaN measurement is never published");

// gridForSession: the grid a viewer must draw so it matches the PTY it drives.
eq(
  gridForSession({ cols: 46, rows: 30 }),
  { cols: TERMINAL_MIN_COLS, rows: 30 },
  "narrow pane pins to the floor",
);
eq(gridForSession({ cols: 152, rows: 20 }), { cols: 152, rows: 20 }, "wide pane keeps its fit");
eq(gridForSession({ cols: 74, rows: 1 }), null, "1-row host is collapsed, not narrow");
eq(
  gridForSession({ cols: TERMINAL_COLLAPSED_COLS - 1, rows: 30 }),
  null,
  "hair-thin host is collapsed",
);
eq(gridForSession({ cols: NaN, rows: 30 }), null, "NaN is collapsed");
{
  const g = gridForSession({ cols: 41, rows: 24 })!;
  eq(
    clampPtyGeometry(g).clamped,
    false,
    "a pinned grid is exactly what the server applies (no clamp)",
  );
}

// A real viewport publishes, including the smallest phone-sized one.
eq(ptyResizeToPublish({ cols: 152, rows: 20 }, null), { cols: 152, rows: 20 }, "desktop publishes");
eq(
  ptyResizeToPublish({ cols: TERMINAL_MIN_COLS, rows: TERMINAL_MIN_ROWS }, null),
  { cols: TERMINAL_MIN_COLS, rows: TERMINAL_MIN_ROWS },
  "exactly at the floor still publishes",
);

// ResizeObserver fires on every layout pass; each duplicate used to be a real
// POST that woke the runner to re-apply a size it already had.
eq(
  ptyResizeToPublish({ cols: 152, rows: 20 }, { cols: 152, rows: 20 }),
  null,
  "unchanged size stays silent",
);
eq(
  ptyResizeToPublish({ cols: 152, rows: 21 }, { cols: 152, rows: 20 }),
  { cols: 152, rows: 21 },
  "one row taller does publish",
);

// A collapse must not overwrite the last good size — the session keeps it.
eq(
  ptyResizeToPublish({ cols: 74, rows: 1 }, { cols: 152, rows: 20 }),
  null,
  "collapse after a good size stays silent",
);

// --- what the boundary accepts ------------------------------------------------

// The server floors independently: an old bundle or any other caller is bound
// by the same rule without importing the client's decision.
eq(
  clampPtyGeometry({ cols: 74, rows: 1 }),
  { cols: 74, rows: TERMINAL_MIN_ROWS, clamped: true },
  "server floors rows",
);
eq(
  clampPtyGeometry({ cols: 3, rows: 40 }),
  { cols: TERMINAL_MIN_COLS, rows: 40, clamped: true },
  "server floors cols",
);
eq(
  clampPtyGeometry({ cols: 152, rows: 20 }),
  { cols: 152, rows: 20, clamped: false },
  "real size passes through untouched",
);
eq(
  clampPtyGeometry({ cols: TERMINAL_MIN_COLS, rows: TERMINAL_MIN_ROWS }),
  { cols: TERMINAL_MIN_COLS, rows: TERMINAL_MIN_ROWS, clamped: false },
  "at the floor is not a clamp",
);

// The two layers must agree in one direction: anything the client publishes
// must survive the server untouched, or the PTY would fight the viewer.
for (const geom of [
  { cols: TERMINAL_MIN_COLS, rows: TERMINAL_MIN_ROWS },
  { cols: 74, rows: 12 },
  { cols: 152, rows: 20 },
  { cols: 240, rows: 60 },
]) {
  const published = ptyResizeToPublish(geom, null);
  if (published) {
    eq(
      clampPtyGeometry(published).clamped,
      false,
      `client-published ${geom.cols}x${geom.rows} is never clamped`,
    );
  }
}

// ── Which session the viewer attaches to ─────────────────────────────────────
// The safety half of the 2026-08-18 phone report: /terminal?tab=orangecat found
// no such session, silently attached to "sbb-lost-found", and kept telling the
// operator their keystrokes were going "straight to the session".

const RUNNING = ["sbb-lost-found", "loki"];

eq(
  resolveTabAttachment({
    requestedTab: "orangecat",
    selected: "orangecat",
    tabs: RUNNING,
    loading: false,
  }),
  { activeTab: null, deepLinkMiss: true },
  "a deep link that matches nothing attaches to NOTHING",
);
eq(
  resolveTabAttachment({
    requestedTab: "orangecat",
    selected: "orangecat",
    tabs: RUNNING,
    loading: true,
  }),
  { activeTab: null, deepLinkMiss: false },
  "mid-fetch is not yet evidence the session is gone",
);
eq(
  resolveTabAttachment({
    requestedTab: "orangecat",
    selected: "loki",
    tabs: RUNNING,
    loading: false,
  }),
  { activeTab: "loki", deepLinkMiss: false },
  "picking a session from the miss state clears it",
);
eq(
  resolveTabAttachment({
    requestedTab: "loki",
    selected: "loki",
    tabs: RUNNING,
    loading: false,
  }),
  { activeTab: "loki", deepLinkMiss: false },
  "a deep link that hits attaches to what was asked for",
);
eq(
  resolveTabAttachment({ requestedTab: null, selected: null, tabs: RUNNING, loading: false }),
  { activeTab: "sbb-lost-found", deepLinkMiss: false },
  "with no deep link, first tab is a fine default",
);
eq(
  resolveTabAttachment({
    requestedTab: "orangecat",
    selected: "orangecat",
    tabs: [],
    loading: false,
  }),
  { activeTab: null, deepLinkMiss: true },
  "nothing running is still a miss, not a blank live pane",
);

// ── Fitting a phone to an 80-column screen ───────────────────────────────────

eq(nextFontSizeForTarget(13, 80), null, "already at target — stop");
eq(nextFontSizeForTarget(13, 120), null, "wider than target — stop");
eq(nextFontSizeForTarget(13, 0), null, "unlaid-out host — stop rather than divide by nothing");
eq(
  nextFontSizeForTarget(TERMINAL_MOBILE_MIN_FONT, 44),
  null,
  "at the floor there is nowhere left to go",
);
eq(
  nextFontSizeForTarget(13, 44),
  7,
  "390px phone at 13px (44 cols) lands on the floor in one step",
);
eq(nextFontSizeForTarget(12, 76), 11, "a near miss steps down by one instead of standing still");
check(
  "every step strictly shrinks",
  (() => {
    // The property that matters: the walk terminates. Sweep every plausible
    // (size, cols) pair and assert progress or a stop — never a repeat.
    for (let size = TERMINAL_MOBILE_MIN_FONT; size <= TERMINAL_MOBILE_MAX_FONT; size++) {
      for (let cols = 1; cols < TERMINAL_TARGET_COLS; cols++) {
        const next = nextFontSizeForTarget(size, cols);
        if (next === null) continue;
        if (next >= size || next < TERMINAL_MOBILE_MIN_FONT) return false;
      }
    }
    return true;
  })(),
);

console.log(`${pass}/${pass + fail} terminal-viewport cases passed`);
if (fail > 0) process.exit(1);
