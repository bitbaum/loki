/**
 * Where a workbench window goes, from the real list of displays. Pure, so
 * scripts/test/workbench-placement.ts can run it without Electron; the
 * Electron side (workbench-windows.ts) only reads displays and applies bounds.
 *
 * Placement is asked for by the web shell (src/lib/workbench/windows.ts),
 * which cannot open a window of its own inside Fleet Runner — every
 * window.open there goes to the default browser.
 */
export type Rect = { x: number; y: number; width: number; height: number }
export type DisplayRect = { id: number; workArea: Rect }
export type WorkbenchPlacement = 'beside' | 'other-screen'

export type Placed = {
  /** The new window. */
  window: Rect
  /** The caller's window, where "beside" tiles the two; null leaves it alone. */
  caller: Rect | null
}

/** Half of a work area, left or right; never narrower than a usable page. */
function half(area: Rect, side: 'left' | 'right'): Rect {
  const width = Math.max(480, Math.floor(area.width / 2))
  return side === 'left'
    ? { x: area.x, y: area.y, width, height: area.height }
    : { x: area.x + area.width - width, y: area.y, width, height: area.height }
}

export function placeWorkbenchWindow(opts: {
  placement: WorkbenchPlacement
  displays: readonly DisplayRect[]
  /** The display the caller's window is on. */
  currentId: number
}): Placed {
  const current = opts.displays.find((d) => d.id === opts.currentId) ?? opts.displays[0]
  const other = opts.displays.find((d) => d.id !== current.id) ?? null
  if (opts.placement === 'other-screen' && other) return { window: other.workArea, caller: null }
  // Beside — or asked for the other screen where there is only one: tile
  // this display, the caller on the left and the new window on the right.
  return { window: half(current.workArea, 'right'), caller: half(current.workArea, 'left') }
}

/** Only pages can be opened: no file:, javascript: or app-specific schemes. */
export function isOpenableUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}
