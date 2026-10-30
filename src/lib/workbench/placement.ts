/**
 * Where a workbench window goes, from a list of displays. Pure and shared:
 * Fleet Runner's main process places real windows with it
 * (desktop/src/main/workbench-windows.ts), the browser sizes a popup with
 * it (lib/workbench/windows.ts), and scripts/test/workbench-placement.ts
 * runs it without either. One rule, one place.
 */
export type Rect = { x: number; y: number; width: number; height: number };
export type DisplayRect = { id: number; workArea: Rect };
export type WorkbenchPlacement = "beside" | "other-screen";

export type Placed = {
  /** The new window. */
  window: Rect;
  /** The caller's window, where "beside" tiles the two; null leaves it alone. */
  caller: Rect | null;
};

/** A page narrower than this is not a workable page. */
export const MIN_WINDOW_WIDTH = 480;

/**
 * Tile one work area: the caller on the left, the new window on the right,
 * half each — unless a minimum says otherwise. Fleet Runner's main window
 * will not go under 800px, so on a 1440px display halves would overlap;
 * the caller keeps its minimum and the new window takes what is left,
 * down to its own minimum. Only a display too small for both overlaps.
 */
function tile(area: Rect, minCaller: number, minWindow: number): Placed {
  let callerWidth = Math.max(Math.floor(area.width / 2), minCaller);
  let windowWidth = area.width - callerWidth;
  if (windowWidth < minWindow) {
    windowWidth = Math.min(minWindow, area.width);
    callerWidth = Math.max(area.width - windowWidth, minCaller);
  }
  return {
    caller: { x: area.x, y: area.y, width: callerWidth, height: area.height },
    window: {
      x: area.x + area.width - windowWidth,
      y: area.y,
      width: windowWidth,
      height: area.height,
    },
  };
}

export function placeWorkbenchWindow(opts: {
  placement: WorkbenchPlacement;
  displays: readonly DisplayRect[];
  /** The display the caller's window is on. */
  currentId: number;
  /** The caller's minimum width (0 where it cannot be moved anyway). */
  minCallerWidth?: number;
}): Placed {
  const current = opts.displays.find((d) => d.id === opts.currentId) ?? opts.displays[0];
  const other = opts.displays.find((d) => d.id !== current.id) ?? null;
  if (opts.placement === "other-screen" && other) return { window: other.workArea, caller: null };
  // Beside — or asked for the other screen where there is only one.
  return tile(current.workArea, opts.minCallerWidth ?? 0, MIN_WINDOW_WIDTH);
}

/** Only pages can be opened: no file:, javascript: or app-specific schemes. */
export function isOpenableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * One window per page. The owner's link to their site carries a pass in the
 * fragment that is minted afresh on every visit to the project page, so two
 * taps on "Open the site" are two different URLs for one window — and the
 * fragment never reaches the server anyway. Loki's own pane URLs carry none.
 */
export function windowKey(url: string): string {
  return url.split("#")[0];
}
