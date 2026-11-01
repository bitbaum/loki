import {
  placeWorkbenchWindow,
  windowKey,
  type DisplayRect,
  type Rect,
  type WorkbenchPlacement,
} from "@/lib/workbench/placement";

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
 * A window this page already opened is brought forward, never navigated
 * again: the site's address carries a pass in its fragment that is minted
 * afresh per visit, and a second navigation would leave the new one in the
 * address bar unread (the widget lifts it out only at boot). Where the site
 * severs the relationship (COOP), the handle reads as closed and the window
 * opens again — a duplicate, never a leak.
 *
 * The placement arithmetic is shared with Fleet Runner
 * (lib/workbench/placement.ts); the rest touches `window` and is kept thin.
 */
export type WindowOpening =
  /** Fleet Runner placed it. */
  | { how: "desktop" }
  /** A browser placed it on the screen asked for. */
  | { how: "placed" }
  /** A browser opened it; the person moves it. */
  | { how: "opened" }
  /** It was already open; it is in front now. */
  | { how: "focused" }
  /** The browser refused (a popup blocker, or the click had gone stale). */
  | { how: "blocked" };

/** What an opening that needs a word from us says; the rest say nothing. */
export function openingNote(opening: WindowOpening | null): string | null {
  if (opening?.how === "blocked")
    return "The window could not be opened. Allow pop-ups for Loki, then try again.";
  return null;
}

export function popupFeatures(rect: Rect): string {
  return `popup,left=${rect.x},top=${rect.y},width=${rect.width},height=${rect.height}`;
}

/** The Window Management API (Chromium), typed only as far as this uses it. */
type ScreenDetailed = {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
};
type ScreenDetails = { screens: ScreenDetailed[]; currentScreen: ScreenDetailed };
type WindowWithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetails> };

function rectOf(s: ScreenDetailed): Rect {
  return { x: s.availLeft, y: s.availTop, width: s.availWidth, height: s.availHeight };
}

/** This screen, from what every browser exposes. */
function thisScreen(): Rect {
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  return { x: s.availLeft ?? 0, y: s.availTop ?? 0, width: s.availWidth, height: s.availHeight };
}

/** The screens as displays, with this one named; null where the browser
 *  cannot say or the person said no. */
async function displaysOrNull(): Promise<{ displays: DisplayRect[]; currentId: number } | null> {
  const w = window as WindowWithScreens;
  if (typeof w.getScreenDetails !== "function") return null;
  try {
    const details = await w.getScreenDetails();
    const displays = details.screens.map((s, id) => ({ id, workArea: rectOf(s) }));
    return { displays, currentId: Math.max(0, details.screens.indexOf(details.currentScreen)) };
  } catch {
    return null;
  }
}

/**
 * Ask for the screens now, while a click is fresh. The permission prompt
 * takes the person's attention, and a click that waits for it goes stale:
 * `window.open` after it is treated as unasked-for and refused. So the
 * prompt is raised when "On the other screen" is chosen, and the open that
 * follows finds the permission already given.
 */
export function primeScreens(): void {
  void displaysOrNull();
}

const handles = new Map<string, Window>();

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
  const key = `${opts.name}:${windowKey(opts.url)}`;
  const existing = handles.get(key);
  if (existing && !existing.closed) {
    existing.focus();
    return { how: "focused" };
  }
  const screens = opts.placement === "other-screen" ? await displaysOrNull() : null;
  const placed = placeWorkbenchWindow({
    placement: opts.placement,
    displays: screens?.displays ?? [{ id: 0, workArea: thisScreen() }],
    currentId: screens?.currentId ?? 0,
  });
  const handle = window.open(opts.url, opts.name, popupFeatures(placed.window));
  if (!handle) return { how: "blocked" };
  handles.set(key, handle);
  return { how: placed.caller === null ? "placed" : "opened" };
}
