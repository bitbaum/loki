import type { WorkbenchPlacement } from "@/config/workbench";

/**
 * Opening a window from the workbench — a pane of Loki's own, or the
 * project's site — and putting it where the person asked: beside this one,
 * or on the other screen.
 *
 * Three ways, best first, each one the honest capability of where it runs:
 *  1. Fleet Runner (the desktop app) places windows on displays itself —
 *     the web shell cannot `window.open` there at all (every new window is
 *     sent to the default browser), so this is the only path inside it.
 *  2. A browser with the Window Management API (Chromium) tells us the other
 *     screen's bounds once the person allows it, and a popup can be placed.
 *  3. Any browser: a popup, sized to half this screen, left for the person
 *     to drag where they want it.
 *
 * The bounds arithmetic is pure (scripts/test/workbench-windows.ts); the
 * rest touches `window` and is kept thin.
 */
export type ScreenRect = { left: number; top: number; width: number; height: number };

export type WindowOpening =
  /** Fleet Runner placed it. */
  | { how: "desktop" }
  /** A browser placed it on the screen asked for. */
  | { how: "placed" }
  /** A browser opened it; the person moves it. */
  | { how: "opened" }
  /** The browser refused (a popup blocker). */
  | { how: "blocked" };

/** Where a new window goes, as the `window.open` features string wants it. */
export function popupBounds(
  placement: WorkbenchPlacement,
  current: ScreenRect,
  other: ScreenRect | null,
): ScreenRect {
  if (placement === "other-screen" && other) return other;
  // Beside: the right half of this screen. The person's own window is left
  // where it is; a page cannot move the window that opened it.
  const width = Math.max(480, Math.floor(current.width / 2));
  return {
    left: current.left + current.width - width,
    top: current.top,
    width,
    height: current.height,
  };
}

export function popupFeatures(rect: ScreenRect): string {
  return `popup,left=${rect.left},top=${rect.top},width=${rect.width},height=${rect.height}`;
}

/** The Window Management API (Chromium), typed only as far as this uses it. */
type ScreenDetailed = {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary: boolean;
};
type ScreenDetails = { screens: ScreenDetailed[]; currentScreen: ScreenDetailed };
type WindowWithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetails> };

function rectOf(s: ScreenDetailed): ScreenRect {
  return { left: s.availLeft, top: s.availTop, width: s.availWidth, height: s.availHeight };
}

/** This screen, from what every browser exposes. */
function thisScreen(): ScreenRect {
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  return {
    left: s.availLeft ?? 0,
    top: s.availTop ?? 0,
    width: s.availWidth,
    height: s.availHeight,
  };
}

/** Ask the browser for the screens; null where it cannot or the person said no. */
async function screensOrNull(): Promise<ScreenDetails | null> {
  const w = window as WindowWithScreens;
  if (typeof w.getScreenDetails !== "function") return null;
  try {
    return await w.getScreenDetails();
  } catch {
    return null;
  }
}

export async function openWorkbenchWindow(opts: {
  url: string;
  name: string;
  placement: WorkbenchPlacement;
}): Promise<WindowOpening> {
  const bridge = window.fleetRunner?.openWorkbenchWindow;
  if (bridge) {
    const result = await bridge(opts.url, opts.placement).catch(() => ({ ok: false as const }));
    if (result.ok) return { how: "desktop" };
    // An older desktop build without the method lands below — and there
    // window.open goes to the default browser, which still opens the page.
  }
  const details = opts.placement === "other-screen" ? await screensOrNull() : null;
  const other = details?.screens.find((s) => s !== details.currentScreen) ?? null;
  const rect = popupBounds(
    opts.placement,
    details ? rectOf(details.currentScreen) : thisScreen(),
    other ? rectOf(other) : null,
  );
  const handle = window.open(opts.url, opts.name, popupFeatures(rect));
  if (!handle) return { how: "blocked" };
  return { how: other ? "placed" : "opened" };
}
