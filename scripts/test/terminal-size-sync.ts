// The terminal was unreadable because the grid the viewer drew (79 cols) and
// the PTY the agent drew into (120 cols) disagreed, and nothing told the PTY.
// These cases pin the path that closes that gap: fit on mount, fit again on
// every host resize, and publish the fitted size to the PTY
// (src/lib/terminal-size-sync.ts).
// Run: npx tsx scripts/test/terminal-size-sync.ts
import { readFileSync } from "fs";
import { join } from "path";
import { createPtySizeSync, watchTerminalHost } from "@/lib/terminal-size-sync";
import { TERMINAL_MIN_COLS, type PtyGeometry } from "@/lib/terminal-viewport";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    console.error(`✗ ${label}: expected ${e}, got ${a}`);
  }
}

/** A stand-in for xterm + FitAddon: `fit()` snaps the grid to the host box. */
function fakeTerminal(initial: PtyGeometry) {
  const host = { ...initial };
  const grid = { cols: 0, rows: 0 };
  let fits = 0;
  return {
    host,
    grid,
    fits: () => fits,
    fit: () => {
      fits++;
      grid.cols = host.cols;
      grid.rows = host.rows;
    },
    measure: () => ({ cols: grid.cols, rows: grid.rows }),
    pin: (cols: number, rows: number) => {
      grid.cols = cols;
      grid.rows = rows;
    },
  };
}

/** A ResizeObserver we can fire by hand. */
function fakeObserver() {
  const instances: { cb: () => void; observed: unknown[]; disconnected: boolean }[] = [];
  class FakeRO {
    private rec: (typeof instances)[number];
    constructor(cb: () => void) {
      this.rec = { cb, observed: [], disconnected: false };
      instances.push(this.rec);
    }
    observe(el: unknown) {
      this.rec.observed.push(el);
    }
    disconnect() {
      this.rec.disconnected = true;
    }
  }
  return { FakeRO, instances, fire: () => instances.forEach((i) => !i.disconnected && i.cb()) };
}

function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener: (t: string, cb: () => void) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(cb);
    },
    removeEventListener: (t: string, cb: () => void) => listeners.get(t)?.delete(cb),
    emit: (t: string) => listeners.get(t)?.forEach((cb) => cb()),
    count: (t: string) => listeners.get(t)?.size ?? 0,
  };
}

// --- mount: fit, then tell the PTY -------------------------------------------
{
  const term = fakeTerminal({ cols: 79, rows: 21 });
  const published: PtyGeometry[] = [];
  const reported: PtyGeometry[] = [];
  const sizes = createPtySizeSync({
    fit: term.fit,
    measure: term.measure,
    pin: term.pin,
    publish: (cols, rows) => published.push({ cols, rows }),
    onGeometry: (g) => reported.push(g),
  });
  const ro = fakeObserver();
  const win = fakeWindow();
  const stop = watchTerminalHost({} as Element, sizes, {
    ResizeObserverImpl: ro.FakeRO,
    focusTarget: win,
  });

  eq(term.fits() >= 1, true, "the grid is fitted on mount, before any resize event");
  eq(published, [{ cols: 79, rows: 21 }], "the mounted size is published to the PTY");
  eq(reported.at(-1), { cols: 79, rows: 21 }, "the mounted size is reported to the chrome");
  eq(ro.instances[0]?.observed.length, 1, "the host box is observed");

  // The same box re-laid-out (ResizeObserver fires on every layout pass) is
  // not news — each duplicate was a real POST that woke the runner.
  ro.fire();
  eq(published.length, 1, "an unchanged size is not published twice");

  // The container grows — the Loki rail closes, or the pane is expanded.
  term.host.cols = 181;
  term.host.rows = 44;
  ro.fire();
  eq(published.at(-1), { cols: 181, rows: 44 }, "a container resize re-fits and re-publishes");

  // A collapsed host (mid-mount, hidden panel) must never squash the session.
  term.host.cols = 1;
  term.host.rows = 1;
  ro.fire();
  eq(published.at(-1), { cols: 181, rows: 44 }, "a collapsed host publishes nothing");
  eq(reported.at(-1), { cols: 1, rows: 1 }, "…but the grid it measured is still reported");

  // Coming back to the window re-asserts this viewer's size, even when it is
  // the size it last sent — another viewer may have resized the shared PTY.
  term.host.cols = 181;
  term.host.rows = 44;
  ro.fire(); // back to the last published size: silent
  const before = published.length;
  win.emit("focus");
  eq(published.length, before + 1, "window focus re-publishes the current size");
  eq(published.at(-1), { cols: 181, rows: 44 }, "…and it is the size on screen");

  stop();
  eq(ro.instances[0]?.disconnected, true, "cleanup disconnects the observer");
  eq(win.count("focus"), 0, "cleanup removes the focus listener");
  term.host.cols = 120;
  ro.fire();
  eq(published.at(-1), { cols: 181, rows: 44 }, "nothing is published after cleanup");
}

// --- a host that is not laid out yet -----------------------------------------
{
  const published: PtyGeometry[] = [];
  const sizes = createPtySizeSync({
    fit: () => {
      throw new Error("host has no dimensions");
    },
    measure: () => ({ cols: 100, rows: 30 }),
    pin: () => {},
    publish: (cols, rows) => published.push({ cols, rows }),
  });
  eq(sizes.sync(), null, "a fit that throws is a skipped pass, not a crash");
  eq(published.length, 0, "…and publishes nothing");
}

// --- a pane narrower than the floor: grid and PTY must still agree ----------
// Prod 2026-09-25: a cloud `claude` tab in a 46-column pane (41 after A+). The
// viewer stayed silent under TERMINAL_MIN_COLS and KEPT its 46-column grid, so
// the PTY stayed at its spawn size of 120 and every row wrapped mid-token. The
// grid is now pinned up to the floor and that is what the PTY is told.
{
  const term = fakeTerminal({ cols: 46, rows: 30 });
  const published: PtyGeometry[] = [];
  const reported: PtyGeometry[] = [];
  const pinned: PtyGeometry[] = [];
  const sizes = createPtySizeSync({
    fit: term.fit,
    measure: term.measure,
    pin: (cols, rows) => {
      pinned.push({ cols, rows });
      term.pin(cols, rows);
    },
    publish: (cols, rows) => published.push({ cols, rows }),
    onGeometry: (g) => reported.push(g),
  });
  sizes.sync();
  eq(
    pinned,
    [{ cols: TERMINAL_MIN_COLS, rows: 30 }],
    "a 46-column pane pins the grid to the floor",
  );
  eq(
    published,
    [{ cols: TERMINAL_MIN_COLS, rows: 30 }],
    "…and publishes that same size to the PTY",
  );
  eq(term.measure(), published.at(-1), "…so the grid drawn IS the PTY's size");
  eq(
    reported.at(-1),
    { cols: TERMINAL_MIN_COLS, rows: 30 },
    "…and the chrome reports the real grid",
  );

  // A+ narrows the fit to 41: still the floor, nothing new to tell the PTY.
  term.host.cols = 41;
  sizes.sync();
  eq(published.length, 1, "a narrower fit under the floor does not re-publish the same size");
  eq(term.measure().cols, TERMINAL_MIN_COLS, "…but the grid is re-pinned after the re-fit");

  // Widening past the floor needs no pin and publishes the real width.
  term.host.cols = 96;
  sizes.sync();
  eq(
    published.at(-1),
    { cols: 96, rows: 30 },
    "a pane wider than the floor publishes its own width",
  );
  eq(pinned.length, 2, "…without pinning");
}

// --- the one xterm publishes whether or not it captures keystrokes ------------
// The incident was a gate, not a missing fit: `if (!interactive) return;` in
// front of the publish meant Prompt mode, Voice mode and every phone never
// resized the PTY. That gate lives in a React component this suite cannot
// mount, so pin the wiring by reading it.
{
  const src = readFileSync(join(process.cwd(), "src/components/terminal/TerminalView.tsx"), "utf8");
  const start = src.indexOf("createPtySizeSync({");
  const call = start >= 0 ? src.slice(start, src.indexOf("});", start)) : "";
  eq(start >= 0, true, "TerminalView sizes its PTY through createPtySizeSync");
  eq(/transport\.sendResize/.test(call), true, "…publishing to the transport");
  eq(/interactive/.test(call), false, "…with no keystroke-capture condition on the publish");
  const between =
    start >= 0 ? src.slice(src.lastIndexOf("const fitFontToTarget", start), start) : "";
  eq(/if \(!interactive\)/.test(between), false, "no `if (!interactive)` guard in front of it");
}

console.log(`terminal-size-sync: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
