import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import {
  isOpenableUrl,
  placeWorkbenchWindow,
  sameOrigin,
  type WorkbenchPlacement,
} from './workbench-placement'

/**
 * Workbench windows: a pane of Loki's own, or the project's site, opened
 * beside the caller or on the other display.
 *
 * Fleet Runner wraps the web shell, and the web shell cannot open windows
 * here (the main window's window-open handler sends everything external).
 * So the workbench asks through the bridge, and this module is the one
 * place a second window is made: it reads the real display list, tiles or
 * moves, and brings a window already open forward instead of opening it
 * twice — the browser's named-window behaviour, done by hand.
 *
 * A window on the shell's own origin gets the preload (it is Loki, and may
 * itself open windows); any other page gets none and stays sandboxed.
 */
const open = new Map<string, BrowserWindow>()

export type OpenOutcome = { ok: true; displays: number } | { ok: false; error: string }

export function openWorkbenchWindow(opts: {
  caller: BrowserWindow | null
  url: string
  placement: WorkbenchPlacement
  shellUrl: string
  preloadPath: string
}): OpenOutcome {
  if (!isOpenableUrl(opts.url)) return { ok: false, error: 'not a page' }
  const placement: WorkbenchPlacement = opts.placement === 'other-screen' ? 'other-screen' : 'beside'

  const existing = open.get(opts.url)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return { ok: true, displays: screen.getAllDisplays().length }
  }

  const displays = screen.getAllDisplays()
  const callerBounds = opts.caller?.getBounds() ?? null
  const currentId = (callerBounds ? screen.getDisplayMatching(callerBounds) : screen.getPrimaryDisplay()).id
  const placed = placeWorkbenchWindow({ placement, displays, currentId })

  if (placed.caller && opts.caller && !opts.caller.isDestroyed()) {
    if (opts.caller.isMaximized()) opts.caller.unmaximize()
    opts.caller.setBounds(placed.caller)
  }

  const ours = sameOrigin(opts.url, opts.shellUrl)
  const win = new BrowserWindow({
    ...placed.window,
    minWidth: 480,
    minHeight: 400,
    autoHideMenuBar: !ours,
    webPreferences: ours
      ? { preload: opts.preloadPath, sandbox: false }
      : { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  open.set(opts.url, win)
  win.on('closed', () => {
    if (open.get(opts.url) === win) open.delete(opts.url)
  })
  // The same rule as the main window: a page may not grow more windows of
  // its own here; a link to elsewhere opens in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOpenableUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void win.loadURL(opts.url).catch(() => {})
  return { ok: true, displays: displays.length }
}

export function workbenchPreloadPath(mainDir: string): string {
  return join(mainDir, '../preload/index.js')
}
