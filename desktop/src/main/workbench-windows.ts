import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import {
  isOpenableUrl,
  MIN_WINDOW_WIDTH,
  placeWorkbenchWindow,
  sameOrigin,
  windowKey,
  type Placed,
  type WorkbenchPlacement,
} from '@/lib/workbench/placement'

/**
 * Workbench windows: a pane of Loki's own, or the project's site, opened
 * beside the caller or on the other display.
 *
 * Fleet Runner wraps the web shell, and the web shell cannot open windows
 * here (the main window's window-open handler sends everything external).
 * So the workbench asks through the bridge, and this module is the one
 * place a second window is made: it reads the real display list, tiles or
 * moves, and brings a window already open forward — restored and placed
 * where the person now asks — instead of opening it twice.
 *
 * A window on the shell's own origin gets the preload (it is Loki, and may
 * itself open windows); any other page gets none and stays sandboxed.
 */
const open = new Map<string, BrowserWindow>()

export type OpenOutcome = { ok: true; displays: number } | { ok: false; error: string }

function place(caller: BrowserWindow | null, placement: WorkbenchPlacement): Placed {
  const callerBounds = caller?.getBounds() ?? null
  const current = callerBounds ? screen.getDisplayMatching(callerBounds) : screen.getPrimaryDisplay()
  const placed = placeWorkbenchWindow({
    placement,
    displays: screen.getAllDisplays(),
    currentId: current.id,
    minCallerWidth: caller?.getMinimumSize()[0] ?? 0,
  })
  if (placed.caller && caller && !caller.isDestroyed()) {
    if (caller.isMaximized()) caller.unmaximize()
    caller.setBounds(placed.caller)
  }
  return placed
}

export function openWorkbenchWindow(opts: {
  caller: BrowserWindow | null
  url: string
  placement: WorkbenchPlacement
  shellUrl: string
  preloadPath: string
}): OpenOutcome {
  if (!isOpenableUrl(opts.url)) return { ok: false, error: 'not a page' }
  const placement: WorkbenchPlacement = opts.placement === 'other-screen' ? 'other-screen' : 'beside'
  const displays = screen.getAllDisplays().length

  const key = windowKey(opts.url)
  const existing = open.get(key)
  if (existing && !existing.isDestroyed()) {
    // Asked again: where the person asks NOW, in front, and not minimized.
    const placed = place(opts.caller, placement)
    if (existing.isMinimized()) existing.restore()
    existing.setBounds(placed.window)
    existing.focus()
    return { ok: true, displays }
  }

  const placed = place(opts.caller, placement)
  const ours = sameOrigin(opts.url, opts.shellUrl)
  const win = new BrowserWindow({
    ...placed.window,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: 400,
    autoHideMenuBar: !ours,
    webPreferences: ours
      ? { preload: opts.preloadPath, sandbox: false }
      : { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  open.set(key, win)
  win.on('closed', () => {
    if (open.get(key) === win) open.delete(key)
  })
  // The same rule as the main window: a page may not grow more windows of
  // its own here; a link to elsewhere opens in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOpenableUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void win.loadURL(opts.url).catch(() => {})
  return { ok: true, displays }
}

export function workbenchPreloadPath(mainDir: string): string {
  return join(mainDir, '../preload/index.js')
}
