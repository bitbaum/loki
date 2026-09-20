import { app, BrowserWindow, dialog, ipcMain, Tray, Menu, nativeImage, Notification, session, shell, powerMonitor } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { startWatcher } from '@home/watcher'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { APP_URL } from '@/config/brand'
import {
  startPoller,
  stopPoller,
  restartPoller,
  onPollerStatus,
  getPollerStatus,
  formatTrayTooltip,
} from './poller'
import { startPusher, stopPusher, restartPusher, pushNow } from './pusher'
import { startCalendarDrain, stopCalendarDrain, restartCalendarDrain } from './calendar-drain'
import { dispatchAutopilot } from './dispatch'
import { peekPtyBuffer } from './pty-runtime'
import { loadToken, saveToken, clearToken, tokenDir } from './token-store'
import { ensureCaptureHook } from './capture-hook'

// v0.7.4 — bundled renderer removed; one UI surface only.
//
// Fleet Runner wraps loki.orangecat.ch in a BrowserWindow + adds native
// integrations (tray, deep-link auth, IPC for Peek + auto-mint + local-dev
// scan, auto-update, splash, persisted window bounds). There is no longer
// a parallel local renderer — the cloud /control IS the UI.
//
// Env overrides:
//   - LOKI_WEB_URL=https://...  → load a preview/dev URL instead of
//                                       the production cloud (for testing).
//   - LOKI_WEB_URL unset/cloud  → loki.orangecat.ch (default).
//
// On load failure (host down, no wifi, OAuth callback to unreachable
// host) the user sees a branded offline page with a retry button, NOT
// a half-working stub UI. The principle: be honest about cloud
// dependency — Slack, Linear, Notion all do the same.
const RAW_URL_OVERRIDE = (process.env.LOKI_WEB_URL || '').trim()
const isHttpOverride = RAW_URL_OVERRIDE.startsWith('http://') || RAW_URL_OVERRIDE.startsWith('https://')
const WEB_SHELL_URL = isHttpOverride ? RAW_URL_OVERRIDE : APP_URL

// Resolve a packaged resource file. electron-builder copies `resources/` into
// `process.resourcesPath` at install time; during dev we read it directly from
// the source tree. Returning '' lets callers treat missing files as no-icon
// instead of crashing the process.
function resourcePath(name: string): string {
  const candidates = is.dev
    ? [join(__dirname, '..', '..', 'resources', name)]
    : [join(process.resourcesPath, name), join(process.resourcesPath, 'resources', name)]
  for (const p of candidates) if (existsSync(p)) return p
  return ''
}

const APP_ICON_PATH  = resourcePath('icon.png')
const TRAY_ICON_PATH = resourcePath('tray-icon.png')

// OAuth identity-provider hosts whose authorize/login pages must stay INSIDE
// the desktop window (see setWindowOpenHandler). The whole flow — our
// /api/auth/signin/<provider> → the provider's authorize page → our
// /api/auth/callback/<provider> — has to run in one cookie jar; the pkce/state
// cookie set at signin is read back at callback. If a provider's authorize
// page escapes to the system browser, the callback lands cookie-less and
// sign-in dies with "pkceCodeVerifier value could not be parsed". Previously
// only github.com was whitelisted, which silently broke X and Google sign-in
// on desktop. Subdomains (api.twitter.com, mobile.twitter.com) match via the
// endsWith check below.
const OAUTH_PROVIDER_HOSTS = ['github.com', 'accounts.google.com', 'x.com', 'twitter.com']

// Chromium SUID sandbox on Linux AppImage is handled at the AppRun wrapper
// level via `linux.executableArgs: ["--no-sandbox"]` in package.json's
// electron-builder config. We can't fix it here — chrome-sandbox aborts
// the process at FATAL *before* Electron's main.ts ever loads, so any
// app.commandLine.appendSwitch() called here runs too late. The flag
// must be on the kernel-exec'd argv before chrome-sandbox is invoked.
// .deb installs handle this differently: dpkg's postinst chmod 4755's
// the chrome-sandbox helper, so the sandbox works the normal way there.

let mainWindow: BrowserWindow | null = null
let stopWatcher: (() => void) | null = null

// Latest auto-update state — captured from electron-updater events, exposed
// to renderers via IPC so the cloud /control surface can show an "Update
// available" banner whenever a new version exists. The state is sticky
// (not cleared between events) so a renderer that mounts AFTER the
// update-available event still sees the info via the initial getUpdateState().
//
// The `installFormat` is critical for the banner: on .deb installs
// electron-updater can DOWNLOAD a new package but cannot APPLY it
// (needs sudo, which Electron can't escalate from userspace). The
// banner shows the exact `sudo dpkg -i <path>` command in that case.
// On AppImage/.dmg/.exe the banner shows a "Restart to install" button
// that calls autoUpdater.quitAndInstall().
type InstallFormat = 'deb' | 'rpm' | 'appimage' | 'dmg' | 'exe' | 'unknown'

type UpdateState = {
  phase?: 'available' | 'downloaded'
  newVersion?: string
  currentVersion?: string
  downloadedFile?: string | null
  installFormat?: InstallFormat
  error?: string
}

let latestUpdate: UpdateState | null = null

/** Detect the install format from the running binary path. The .deb installer
 *  drops the binary under `/opt/Fleet Runner/`; AppImage runs from wherever
 *  the user launched it (their Downloads folder, /opt, etc.) and exposes
 *  APPIMAGE env var; mac uses .dmg → /Applications; Windows uses .exe + nsis. */
function detectInstallFormat(): InstallFormat {
  if (process.platform === 'darwin') return 'dmg'
  if (process.platform === 'win32') return 'exe'
  if (process.platform === 'linux') {
    if (process.env.APPIMAGE) return 'appimage'
    if (process.execPath.startsWith('/opt/Fleet Runner') || process.execPath.startsWith('/usr/lib/fleet-runner')) return 'deb'
    return 'unknown'
  }
  return 'unknown'
}

function broadcastUpdateState(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      try { w.webContents.send('update-state', latestUpdate) } catch { /* ignore */ }
    }
  }
}
// Tray is lifted to module scope so the poller's status callback can refresh
// its tooltip without going through createTray() every time.
let tray: Tray | null = null
// Refresh the tooltip on a short timer so "last poll Ns ago" stays accurate
// between status events (the long-poll cycle is up to 25s).
let trayTickHandle: NodeJS.Timeout | null = null
// Debounce timer for window-state writes so dragging/resizing doesn't hammer
// the disk. Coalesces a burst of move/resize events into a single save.
let saveBoundsHandle: NodeJS.Timeout | null = null

// Loads the bundled local renderer (out/renderer/index.html). Called when:
//   - the cloud web shell fails to load on launch
// Brand black + cream pulled from globals.css :root tokens. Hardcoded here
// because the main process can't import the renderer's CSS — when these
// drift, update both. The splash + offline + window backgroundColor all
// reference these so the user never sees a Chromium-white flash before our
// content paints.
const BRAND_BG = '#0a0a0a'
const BRAND_FG = '#FAF8F5'
const BRAND_ACCENT = '#E06B3A'

// Inline HTML for the splash screen — shown immediately on window create so
// the user sees the brand mark + spinner instead of a black void while the
// real web shell loads. Replaced by the real URL once loadURL resolves.
function splashHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fleet Runner</title>
<style>
  html,body{margin:0;height:100%;background:${BRAND_BG};color:${BRAND_FG};
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    user-select:none;-webkit-user-select:none;}
  .logo{width:64px;height:64px;margin-bottom:24px;opacity:0.95;}
  .name{font-size:15px;font-weight:500;letter-spacing:0.01em;opacity:0.85;}
  .status{font-size:11px;font-weight:400;letter-spacing:0.08em;text-transform:uppercase;
    opacity:0.4;margin-top:18px;}
  .spinner{margin-top:14px;width:18px;height:18px;border:1.5px solid rgba(255,255,255,0.12);
    border-top-color:${BRAND_ACCENT};border-radius:50%;animation:spin .9s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
<svg class="logo" viewBox="0 0 64 64" fill="none">
  <rect x="6" y="6" width="52" height="52" rx="12" stroke="${BRAND_FG}" stroke-opacity="0.85" stroke-width="2"/>
  <rect x="14" y="18" width="22" height="3.5" rx="1.5" fill="${BRAND_FG}" fill-opacity="0.8"/>
  <rect x="14" y="27" width="30" height="3.5" rx="1.5" fill="${BRAND_FG}" fill-opacity="0.6"/>
  <rect x="14" y="36" width="18" height="3.5" rx="1.5" fill="${BRAND_FG}" fill-opacity="0.45"/>
  <circle cx="47" cy="46" r="3" fill="${BRAND_ACCENT}"/>
</svg>
<div class="name">Fleet Runner</div>
<div class="status">Connecting</div>
<div class="spinner"></div>
</body></html>`
}

// Branded offline page. Replaces the previous bare data-URL fallback so a
// transient network blip or hosting hiccup doesn't dump the user in an
// unstyled error. The retry button reloads via IPC (handled below) — the
// user does not need to relaunch the app to recover.
function offlineHtml(targetUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fleet Runner — offline</title>
<style>
  html,body{margin:0;height:100%;background:${BRAND_BG};color:${BRAND_FG};
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:40px;box-sizing:border-box;text-align:center;user-select:none;-webkit-user-select:none;}
  h1{font-size:20px;font-weight:600;margin:0 0 8px;letter-spacing:-0.01em;}
  p{font-size:13px;color:rgba(255,255,255,0.55);margin:0 0 24px;max-width:420px;line-height:1.6;}
  .target{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:11px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
    padding:6px 10px;border-radius:6px;color:rgba(255,255,255,0.45);margin-bottom:24px;}
  button{background:${BRAND_ACCENT};color:${BRAND_FG};border:0;padding:10px 20px;
    border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;letter-spacing:0.01em;}
  button:hover{filter:brightness(1.08);}
  .hint{margin-top:18px;font-size:11px;color:rgba(255,255,255,0.35);max-width:360px;line-height:1.6;}
</style></head><body>
<h1>Can't reach Loki</h1>
<p>The cloud surface didn't respond. This is usually a transient network
or hosting issue. Your local agents keep running regardless —
only the /control UI is offline.</p>
<div class="target">${targetUrl}</div>
<button onclick="window.location.assign('${targetUrl}')">Try again</button>
<div class="hint">If this persists, check your connection. Closing and
reopening Fleet Runner is safe — no local data depends on the web app
being up; the runner keeps pushing state so /control catches up
instantly once it comes back.</div>
</body></html>`
}

const SPLASH_URL = `data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`
const OFFLINE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(offlineHtml(WEB_SHELL_URL))}`

// Persist window bounds across launches so users don't have to resize/move
// every time they open Fleet Runner. Stored as JSON in the userData dir
// (~/.config/Fleet\ Runner on Linux, ~/Library/Application\ Support/Fleet\ Runner
// on mac, %APPDATA%/Fleet Runner on Windows). Failure-tolerant: a corrupt
// file just falls back to defaults.
type WindowState = { width: number; height: number; x?: number; y?: number; isMaximized?: boolean }

function windowStateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState {
  const defaults: WindowState = { width: 1200, height: 800 }
  try {
    const path = windowStateFile()
    if (!existsSync(path)) return defaults
    const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<WindowState>
    // Clamp to a sane range — display config may have changed between launches
    // and we don't want to restore a window onto a disconnected monitor or at
    // a size that's smaller than the app can render usably.
    return {
      width: clamp(data.width ?? 1200, 800, 4000),
      height: clamp(data.height ?? 800, 600, 4000),
      x: typeof data.x === 'number' ? data.x : undefined,
      y: typeof data.y === 'number' ? data.y : undefined,
      isMaximized: !!data.isMaximized,
    }
  } catch {
    return defaults
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    // Use getNormalBounds() so a maximized window saves the underlying
    // restored size, not the screen dimensions (otherwise un-maximizing
    // next launch leaves the window at screen size).
    const bounds = mainWindow.getNormalBounds()
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: mainWindow.isMaximized(),
    }
    writeFileSync(windowStateFile(), JSON.stringify(state), 'utf8')
  } catch (e) {
    console.warn('[desktop] could not save window state:', (e as Error).message)
  }
}

function scheduleSaveWindowState() {
  if (saveBoundsHandle) clearTimeout(saveBoundsHandle)
  saveBoundsHandle = setTimeout(saveWindowState, 400)
}

// Native application menu — gives Fleet Runner the File/Edit/View/Window/Help
// structure macOS users expect at the top of the screen, and Linux/Windows
// users expect at the top of the window. Without this the app feels like a
// browser tab in a wrapper. About dialog uses the native About panel on mac;
// Linux/Windows fall back to a styled message box.
function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin'

  const showAbout = () => {
    if (isMac) {
      // Native About panel on mac — populated via setAboutPanelOptions in
      // whenReady. Just trigger it.
      app.showAboutPanel()
      return
    }
    void dialog.showMessageBox({
      type: 'info',
      title: 'About Fleet Runner',
      message: 'Fleet Runner',
      detail:
        `Version ${app.getVersion()}\n\n` +
        'The local authoritative desktop application for the Loki AI agent fleet platform.\n\n' +
        '© 2026 Cato · Loki',
      buttons: ['Visit Website', 'Close'],
      defaultId: 1,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) void shell.openExternal(APP_URL)
    })
  }

  const reload = () => mainWindow?.webContents.reload()
  const openExternal = (url: string) => () => void shell.openExternal(url)

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { label: 'Check for Updates…', click: () => void autoUpdater.checkForUpdates() },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const },
            ]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: reload },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow?.webContents.reloadIgnoringCache() },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Loki Website', click: openExternal(APP_URL) },
        { label: 'Quickstart Docs', click: openExternal(`${APP_URL}/docs/quickstart`) },
        { label: 'Report an Issue', click: openExternal('https://github.com/bitbaum/loki/issues/new') },
        { label: 'View Releases', click: openExternal('https://github.com/bitbaum/loki-releases/releases') },
        { type: 'separator' },
        { label: 'Privacy', click: openExternal(`${APP_URL}/privacy`) },
        { label: 'Terms', click: openExternal(`${APP_URL}/terms`) },
        { label: 'License', click: openExternal(`${APP_URL}/license`) },
        ...(isMac ? [] : [
          { type: 'separator' as const },
          { label: 'About Fleet Runner', click: showAbout },
        ]),
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}

function createWindow(): void {
  const restored = loadWindowState()
  mainWindow = new BrowserWindow({
    width: restored.width,
    height: restored.height,
    ...(restored.x !== undefined && restored.y !== undefined
      ? { x: restored.x, y: restored.y }
      : {}),
    minWidth: 800,
    minHeight: 600,
    show: false,
    // Brand background so the first paint isn't Chromium-white before our
    // content (splash → web shell) appears. Combined with show:false and
    // ready-to-show, eliminates the white flash entirely.
    backgroundColor: BRAND_BG,
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // If the previous session ended maximized, restore that state once the
  // window is visible (sized to the saved bounds but expanded to full
  // screen). Doing this before show keeps the transition imperceptible.
  if (restored.isMaximized) mainWindow.maximize()

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Persist window geometry across launches. Debounced so a drag/resize
  // gesture doesn't write the file on every pixel of motion.
  mainWindow.on('resize', scheduleSaveWindowState)
  mainWindow.on('move', scheduleSaveWindowState)
  mainWindow.on('maximize', scheduleSaveWindowState)
  mainWindow.on('unmaximize', scheduleSaveWindowState)

  mainWindow.on('close', () => {
    // Flush any pending debounce — the window is going away.
    if (saveBoundsHandle) {
      clearTimeout(saveBoundsHandle)
      saveBoundsHandle = null
    }
    saveWindowState()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Keep OAuth redirects in the same window instead of spawning a popup
  // Electron can't follow. The provider authorize pages open via window.open;
  // rejecting them without re-loading in-window would break sign-in inside the
  // desktop app. See OAUTH_PROVIDER_HOSTS for why every configured provider
  // (not just GitHub) must be kept in-window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Our own NextAuth routes (/auth/, /api/auth/) plus every configured OAuth
    // provider's authorize/login host stay in the main window so the pkce/state
    // cookie survives the round-trip. Everything else opens externally.
    let host = ''
    try { host = new URL(url).hostname.toLowerCase() } catch { /* non-URL target */ }
    const isOurAuthRoute = /\/(api\/)?auth\//i.test(url)
    const isProviderHost = OAUTH_PROVIDER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
    if (isOurAuthRoute || isProviderHost) {
      mainWindow?.loadURL(url).catch(() => {})
      return { action: 'deny' }
    }
    // Everything else (external links, marketing pages) opens in the user's
    // default browser — desktop apps shouldn't become mini-browsers.
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Catch load failures (host down, no wifi, OAuth callback to unreachable
  // host). did-fail-load fires for every aborted/failed navigation; filter
  // out the ones we trigger ourselves and the ABORTED code that's normal
  // during fast successive loadURL calls. On real failure we show a branded
  // offline page with a retry button — honest about the cloud dependency
  // instead of pretending with a half-working local UI (the v0.7.0 mistake).
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, validatedUrl) => {
    if (code === -3) return // ABORTED — fires harmlessly on every successful navigation
    if (validatedUrl === SPLASH_URL || validatedUrl === OFFLINE_URL) return // our own pages
    if (!validatedUrl.startsWith('http')) return // data: URLs etc.
    console.warn(`[desktop] cloud unreachable (${code}: ${desc}) for ${validatedUrl} — showing offline page`)
    mainWindow?.loadURL(OFFLINE_URL).catch(() => {})
  })

  // Load the brand splash immediately so the user sees Fleet Runner the
  // moment the window paints, not a black void. ready-to-show fires fast
  // for the data: URL, then we swap to the real web shell. Chromium
  // replaces the document in-place when WEB_SHELL_URL finishes loading.
  console.log(`[desktop] booting web shell → splash, then ${WEB_SHELL_URL}`)
  void mainWindow.loadURL(SPLASH_URL)
  // Swap to the real URL on the next tick — gives ready-to-show a chance
  // to fire on the splash first so the window appears with content, not
  // blank. On failure: did-fail-load handler above shows the offline page.
  setImmediate(() => {
    mainWindow?.loadURL(WEB_SHELL_URL).catch((err) => {
      console.error('[desktop] failed to load web shell (did-fail-load will swap to offline page):', err?.message ?? err)
    })
  })
  // Open devtools in dev so we can inspect cookies, CSP, network during the spike.
  if (is.dev) mainWindow.webContents.openDevTools({ mode: 'detach' })

  // Token / connect support for using this app as the local runtime for hosted Loki.
  // All persistence + path SSOT lives in ./token-store; this section is only the IPC
  // surface + the restart-on-write side effects the renderer wants.
  ipcMain.handle('save-token', async (_event, token: string) => {
    const result = saveToken(token)
    if (result.ok) {
      // Pick up the new token immediately — without this the poller would
      // keep running with the previous token (or stay idle) until the next
      // restart, defeating the "paste and go" UX. Same for the pusher,
      // which marks the daemon as online on the web UI.
      restartPoller()
      restartPusher()
      restartCalendarDrain()
      // A token just became usable — install the typed-prompt capture hook
      // so directly-typed Claude prompts reach the activity ledger.
      ensureCaptureHook()
    }
    return result
  })

  ipcMain.handle('load-token', async () => loadToken())

  // Used by the in-window auto-mint flow (and Settings UI) when the user
  // wants to disconnect this machine from the control plane without quitting
  // the app — clears the saved token and stops the poller.
  ipcMain.handle('clear-token', async () => {
    const result = clearToken()
    if (result.ok) {
      stopPoller()
      stopPusher()
      stopCalendarDrain()
    }
    return result
  })

  ipcMain.handle('get-config-dir', async () => tokenDir)

  // Live connection status — the renderer (and any in-window React tree
  // running inside web-shell mode) can call this for an immediate snapshot,
  // and listen to the 'poller-status' event below for live updates.
  ipcMain.handle('get-poller-status', async () => {
    return getPollerStatus()
  })

  // Local-dev scan — walks the user's common dev folders for git repos
  // (whether or not they're registered in agent-projects.conf). The web
  // app uses this (when running inside Fleet Runner) to surface the
  // Cursor-style "we see your local repos, import them?" CTA.
  // Roots are configurable via env; default covers the common layouts.
  ipcMain.handle('get-local-dev-projects', async () => {
    const roots = (process.env.LOKI_DEV_ROOTS ?? '~/dev:~/code:~/Code:~/Projects')
      .split(':')
      .map((p) => p.trim().replace(/^~/, homedir()))
      .filter(Boolean)

    const fs_ = await import('node:fs/promises')
    const { join } = await import('node:path')

    const found: Array<{ name: string; path: string; mtimeMs: number; remoteUrl: string | null }> = []
    const seen = new Set<string>()

    // Bounded depth-3 scan: most dev folder layouts are at depth 1 (root/repo)
    // or 2 (root/org/repo). 3 catches monorepo sub-projects without exploding.
    async function walk(dir: string, depth: number) {
      if (depth > 3 || seen.has(dir)) return
      seen.add(dir)
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fs_.readdir(dir, { withFileTypes: true })
      } catch { return }
      const hasGit = entries.some((e) => e.name === '.git')
      if (hasGit) {
        try {
          const stat = await fs_.stat(dir)
          let remoteUrl: string | null = null
          try {
            const cfg = await fs_.readFile(join(dir, '.git', 'config'), 'utf8')
            const match = cfg.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(\S+)/)
            if (match) remoteUrl = match[1] || null
          } catch { /* no remote configured — fine */ }
          found.push({ name: dir.split('/').pop() ?? dir, path: dir, mtimeMs: stat.mtimeMs, remoteUrl })
        } catch { /* skip on stat error */ }
        return  // don't recurse into .git'd repos — sub-projects are usually a different concept
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue
        if (e.name.startsWith('.')) continue
        if (['node_modules', 'dist', 'out', '.next', 'venv', '__pycache__'].includes(e.name)) continue
        await walk(join(dir, e.name), depth + 1)
      }
    }

    for (const root of roots) {
      await walk(root, 0)
    }

    // Most recently modified first — matches "Recent projects" mental model.
    found.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return { projects: found.slice(0, 50) }
  })

  // Local prerequisite scan — uses the shared commandExistsInPath helper
  // (~/.local/bin, ~/.npm-global/bin, ~/.bun/bin, nvm versions, etc.) so a
  // user-local install of claude isn't reported as missing just because
  // Electron's stripped PATH doesn't include those directories.
  //
  // Why no lifetime cache: pre-fix the cache locked the first result for
  // the whole process — if detection failed at boot (PATH not yet
  // augmented, bundled-bin not yet prepended), the user saw "Missing
  // Claude / Install Claude" forever even after refreshing. Each call is
  // ~10ms of file existence checks; cheap. Sub-100ms total scan.
  //
  // Also consults the agent adapter's detectAvailable() — claude.ts always
  // reports available (Anthropic ships installation out-of-band, the
  // binary check is a weak signal). Trusting the adapter aligns this UI
  // with every other call site that reads listAgentRegistry().
  ipcMain.handle('get-installed-clis', async () => {
    const { commandExistsInPath } = await import('@/lib/agents/helpers')
    const { listAgentRegistry } = await import('@/lib/agent-registry')
    const registry = listAgentRegistry()
    const agents: Record<string, boolean> = {}
    for (const id of ['claude', 'codex', 'grok', 'gemini', 'cursor'] as const) {
      const entry = registry.find((r) => r.id === id)
      agents[id] = entry?.available ?? commandExistsInPath(id)
    }
    return { agents }
  })

  // Peek tab — the retained output of the agent's owned PTY, in memory and
  // non-blocking. A tab with no live PTY has no screen to show; that is
  // returned as a specific error rather than a generic failure.
  ipcMain.handle('peek-tab', async (_event, tab: string) => {
    if (typeof tab !== 'string' || tab.trim().length === 0) {
      return { ok: false as const, error: 'invalid tab name' }
    }
    try {
      const content = peekPtyBuffer(tab.trim())
      if (content === null) return { ok: false as const, error: `no running agent for "${tab.trim()}" on this runner` }
      return { ok: true as const, content }
    } catch (e) {
      const msg = (e as Error).message || 'peek failed'
      console.warn(`[desktop] peek-tab failed for "${tab}":`, msg)
      return { ok: false as const, error: msg }
    }
  })

  // Update state — the renderer's UpdateBanner reads this on mount and
  // subscribes via 'update-state' events for live changes. The state is
  // null until electron-updater fires its first 'update-available' event.
  ipcMain.handle('get-update-state', async () => latestUpdate)

  // Apply a downloaded update by quitting + re-launching. Only meaningful
  // for AppImage/dmg/exe — for .deb the renderer should show the manual
  // dpkg command (see UpdateBanner.tsx). Returns true on success; failure
  // (no update downloaded, autoUpdater not initialized) returns false.
  ipcMain.handle('quit-and-install', async () => {
    if (!latestUpdate || latestUpdate.phase !== 'downloaded') return false
    try {
      // electron-updater's quitAndInstall internally calls app.quit() + relaunch.
      // No need for an explicit before-quit save — our before-quit handler
      // tears down the watcher + poller + pusher cleanly.
      autoUpdater.quitAndInstall()
      return true
    } catch (e) {
      console.warn('[desktop] quit-and-install failed:', (e as Error).message)
      return false
    }
  })

  // Reload the web shell from the offline page's retry button. Posts a
  // simple "retry" message via window.postMessage that the offline.html
  // listens for via the preload bridge.
  ipcMain.handle('reload-web-shell', async () => {
    if (!mainWindow) return false
    try {
      await mainWindow.loadURL(WEB_SHELL_URL)
      return true
    } catch (e) {
      console.warn('[desktop] reload-web-shell failed:', (e as Error).message)
      return false
    }
  })
}

// Deep-link auth: clicking `loki://auth?token=ck_...` from the web app
// (the "Open in Fleet Runner" button on Settings → Agent tokens) hands the
// token to the desktop app without copy-paste. The same flow Slack/Linear use.
//
// Protocol registration:
//   - mac/Windows: app.setAsDefaultProtocolClient handles it directly.
//   - Linux .deb: electron-builder writes a .desktop file declaring
//     x-scheme-handler/loki, so xdg-open routes the URL to Fleet Runner.
//   - Linux AppImage: protocol routing depends on the user's launcher.
//     AppImageLauncher and most distros pick it up after first run; some
//     don't. The web UI keeps the "copy token" fallback for that case.
//
// Cold-start handling (Linux/Win): a loki:// click launches Electron,
// and the URL lands in process.argv. We scan it once at boot. Mac uses the
// 'open-url' event (fired before app.whenReady), which we wire below.
app.setAsDefaultProtocolClient('loki')

// Pending URL captured before the main window exists. Filled by 'open-url'
// on mac when the OS launches Fleet Runner via a deep-link before whenReady
// resolves. The save-token logic consumes it the moment the window opens.
let pendingDeepLink: string | null = null

function extractTokenFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'loki:') return null
    // Both /auth and //auth host paths are accepted — different platforms
    // produce slightly different URL shapes for custom schemes and we don't
    // want a punctuation difference to break the flow.
    const path = `${u.host}${u.pathname}`.replace(/\/+/g, '/').replace(/^\//, '')
    if (!path.startsWith('auth')) return null
    const tok = u.searchParams.get('token')
    return tok && tok.length >= 8 ? tok : null
  } catch {
    return null
  }
}

async function handleDeepLinkUrl(url: string) {
  const tok = extractTokenFromUrl(url)
  if (!tok) {
    console.warn('[desktop] ignored malformed deep-link:', url)
    return
  }

  // SECURITY: a loki:// deep-link can originate from ANY page the user
  // visits (a link, a redirect, an <img>/<iframe> src) — the OS hands us the
  // URL with no proof the user meant it. Saving the token + restarting the
  // poller re-points this machine at whatever account owns that token, and the
  // runner then types that account's dispatched commands into local terminals.
  // Without a gate, a malicious page doing `location.href =
  // 'loki://auth?token=<attacker>'` silently converts this machine into
  // the attacker's executor (drive-by RCE). So we NEVER persist a deep-link
  // token without an explicit, human, per-link confirmation. The legitimate
  // flow (user clicks "Connect this machine" in their own Loki settings)
  // costs one extra click; the attack costs the whole exploit.
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
  const confirmOptions = {
    type: 'warning' as const,
    buttons: ['Cancel', 'Connect this machine'],
    defaultId: 0,
    cancelId: 0,
    title: 'Connect Fleet Runner?',
    message: 'Connect this machine to a Loki account?',
    detail:
      'A link just asked to sign this Fleet Runner in. Only continue if YOU ' +
      'just started this from your own Loki settings.\n\n' +
      'After connecting, this machine will run AI-agent commands dispatched ' +
      'to that account. If you did not initiate this, click Cancel.',
    noLink: true,
  }
  const { response } = mainWindow
    ? await dialog.showMessageBox(mainWindow, confirmOptions)
    : await dialog.showMessageBox(confirmOptions)
  if (response !== 1) {
    console.warn('[desktop] deep-link auth declined by user — token NOT saved')
    return
  }

  // Persist via the shared token-store, so there's only one code path for
  // "token reached this machine" — same as save-token IPC + auto-mint flow.
  const result = saveToken(tok)
  if (!result.ok) {
    console.error('[desktop] deep-link auth failed:', result.error)
    return
  }
  restartPoller()
  restartPusher()
  restartCalendarDrain()
  ensureCaptureHook()
  console.log('[desktop] deep-link auth: token saved, poller + pusher restarted')
}

// Mac: 'open-url' fires when loki:// is clicked, even before whenReady.
// Buffer it until the window exists.
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (mainWindow) void handleDeepLinkUrl(url)
  else pendingDeepLink = url
})

// Linux/Windows: only one Fleet Runner should run. A second invocation (from
// a loki:// click after the app is already up) triggers second-instance
// with the new argv; we scan it for the deep-link URL and surface the window.
/** Kill other main runner processes. Singleton lock files can be cleared while
 *  an old instance is still alive (e.g. manual rm ~/.config/fleet-runner/Singleton*),
 *  leaving two pollers racing for commands — the loser often lacks the PTY state
 *  for peek streams and answers with nothing instead. */
function terminateStaleRunnerInstances(): void {
  const myPid = process.pid
  try {
    const out = execSync('pgrep -f "fleet-runner-bin --no-sandbox" || true', { encoding: 'utf8' })
    for (const line of out.trim().split('\n')) {
      const pid = Number.parseInt(line.trim(), 10)
      if (!pid || pid === myPid) continue
      try {
        const cmd = execSync(`ps -p ${pid} -o args=`, { encoding: 'utf8' }).trim()
        if (cmd.includes('--type=')) continue // child process, not the main app
        console.log(`[desktop] terminating stale runner instance pid=${pid}`)
        process.kill(pid, 'SIGTERM')
      } catch { /* process vanished */ }
    }
  } catch { /* pgrep unavailable */ }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
} else {
  terminateStaleRunnerInstances()
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((a) => a.startsWith('loki://'))
    if (url) void handleDeepLinkUrl(url)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.loki.fleet-runner')

  // Hand the desktop's version to the now-Electron-free pusher (it reads this
  // env so the same module runs in the headless box-runner). Set before any
  // pusher start below.
  process.env.LOKI_RUNNER_VERSION = app.getVersion()

  // Crash reporting via Sentry — opt-in. The SDK is no-op until a DSN is
  // present in the environment (SENTRY_DSN or VITE_SENTRY_DSN), so this
  // ships silent by default. When the Sentry project is created and the
  // DSN is set on the user's machine or build env, uncaught exceptions
  // in the main process (and native crashes via minidumps) start flowing.
  const sentryDsn = process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN
  if (sentryDsn) {
    try {
      const { init } = await import('@sentry/electron/main')
      init({
        dsn: sentryDsn,
        release: `fleet-runner@${app.getVersion()}`,
        environment: is.dev ? 'development' : 'production',
      })
      console.log('[desktop] Sentry main-process reporting enabled')
    } catch (e) {
      console.warn('[desktop] Sentry init failed:', (e as Error).message)
    }
  }

  // Application menu — File / Edit / View / Window / Help with proper
  // shortcuts. macOS gets the application menu (with About, Quit, etc.)
  // as the first item; Linux/Windows skip that. Without this Fleet Runner
  // looks like a webview wrapper instead of a native app.
  Menu.setApplicationMenu(buildAppMenu())

  // Native About panel — used by the {role: 'about'} menu item on macOS
  // (which triggers the system About dialog). On Linux/Windows the menu
  // calls dialog.showMessageBox in buildAppMenu instead.
  app.setAboutPanelOptions({
    applicationName: 'Fleet Runner',
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Cato · Loki',
    website: APP_URL,
    credits: 'Owned agent terminals, deep-link auth, auto-update.\nPart of the Loki agent-fleet platform.',
  })

  // Linux/Win cold-start: if Fleet Runner was launched directly via a
  // loki:// click (not while already running), the URL is in argv.
  // Buffer it so we apply it after the window finishes loading.
  const argvUrl = process.argv.find((a) => a.startsWith('loki://'))
  if (argvUrl) pendingDeepLink = argvUrl

  // Mark requests with a Fleet-Runner UA suffix so the deployed app can detect
  // when it's being rendered inside the desktop shell (enabling tray hooks,
  // hotkeys, etc.) without affecting normal browser traffic. Cookies persist
  // by default in Electron's user-data dir → NextAuth session survives across
  // launches with no extra wiring.
  const ua = session.defaultSession.getUserAgent()
  if (!ua.includes('FleetRunner/')) {
    session.defaultSession.setUserAgent(`${ua} FleetRunner/${app.getVersion()}`)
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  createTray()

  // Apply any deep-link captured before the window existed (mac open-url
  // pre-whenReady, or Linux/Win argv URL). Token gets saved + poller restarts.
  if (pendingDeepLink) {
    void handleDeepLinkUrl(pendingDeepLink)
    pendingDeepLink = null
  }

  // Start the embedded home/ watcher bridge inside the desktop main process.
  // This gives us the "real worker idle path": when a dispatched agent finishes
  // and writes its handoff to ~/.loki/sessions/<project>.md, we append
  // worker.idle events to the shared log (just like a standalone home/watcher.ts).
  // Combined with the dispatch-side appendEvent(bridge.dispatch + started/crashed),
  // desktop-originated runs now produce a more complete lifecycle in the event log
  // without requiring the user to run a separate watcher process.
  // The watcher respects the same registered projects from agent-projects.conf.
  //
  // The onIdle subscriber surfaces an OS notification for each completed run.
  // This is the "fire-and-walk-away" UX promise of a Fleet Runner: dispatch an
  // intent and the OS pings you when the agent hands off, regardless of which
  // window has focus.
  try {
    const w = startWatcher({ onIdle: notifyOnIdle })
    stopWatcher = w.close
    console.log('[desktop] embedded watcher started for session.md → worker.idle')
  } catch (e) {
    console.warn('[desktop] could not start embedded watcher:', (e as Error).message)
  }

  // Wire the command poller — the cable that closes the web → local Zellij
  // loop. Status updates flow to the tray tooltip and to any renderer window
  // that wants to surface "connected to loki.orangecat.ch" in the UI.
  onPollerStatus((status) => {
    if (tray) tray.setToolTip(formatTrayTooltip(status))
    // Push to all renderer windows — web-shell mode means the in-window
    // React tree can show a connection chip without polling IPC.
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('poller-status', status)
    })
  })
  startPoller()
  // Typed-prompt capture: ensure the Claude UserPromptSubmit hook is installed
  // so prompts typed directly into a Claude tab (not dispatched through the
  // platform) still appear in Activity. Idempotent; no-op until a token exists.
  ensureCaptureHook()
  // Heartbeat to the cloud control plane so the web UI's "Local daemon
  // online" indicator actually reflects reality. v0.4.0–v0.4.3 had the
  // poller (commands cloud → local) but no pusher (state local → cloud),
  // so /control showed "Local daemon offline" even when dispatch was
  // working. See pusher.ts for the why.
  startPusher()
  // Book cloud-approved calendar events locally via gog. Runs alongside the
  // poller/pusher, sharing their token + base URL. See calendar-drain.ts.
  startCalendarDrain()
  // Refresh the "last poll Ns ago" string between status events so the
  // tooltip never feels frozen during the 25-second long-poll wait.
  trayTickHandle = setInterval(() => {
    if (tray) tray.setToolTip(formatTrayTooltip(getPollerStatus()))
  }, 5_000)

  // Self-heal on wake. Laptop sleep / lid-close silently kills the bridge SSE
  // socket — the #1 cause of a runner that shows "offline" while its process is
  // still alive. The OS hands us 'resume'/'unlock-screen' on wake, so we force
  // the poller (and the bridge subscriber it owns) to reconnect right away
  // instead of waiting out the idle-timeout watchdog. Watchdog + wake-recovery
  // together are what make "Fleet Runner online" reliable across sleep cycles.
  powerMonitor.on('resume', () => {
    console.log('[desktop] system resumed — forcing poller + bridge reconnect')
    restartPoller()
    restartPusher()
    restartCalendarDrain()
  })
  powerMonitor.on('unlock-screen', () => {
    console.log('[desktop] screen unlocked — refreshing poller + bridge')
    restartPoller()
  })

  // Auto-update — read latest-<platform>.yml from the canonical public
  // release host (bitbaum/loki-releases). We override the feed URL
  // explicitly instead of relying on desktop/package.json's publish.repo
  // because electron-builder's build pipeline targets a different repo
  // (bitbaum/loki) than where users actually download from. The
  // mirror script reconciles those.
  //
  // Behavior: silent background check on launch, downloads the newer
  // installer in the background if one exists, surfaces a "ready to install"
  // notification when complete. The user keeps using the current version
  // until they relaunch.
  //
  // Disabled in dev (would interfere with the local Electron dev cycle) and
  // when the renderer is in web-shell mode pointed at a non-prod URL
  // (LOKI_WEB_URL override) — those builds aren't the public binary.
  if (!is.dev) {
    try {
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'bitbaum',
        repo: 'loki-releases',
      })
      autoUpdater.on('error', (err) => {
        console.warn('[desktop] auto-update error:', err?.message ?? err)
        // Surface the failure to renderers so the in-app banner can pivot
        // to the "manual upgrade required" message instead of silently
        // claiming the update path works.
        latestUpdate = { ...(latestUpdate ?? {}), error: err?.message ?? String(err) }
        broadcastUpdateState()
      })
      autoUpdater.on('update-available', (info) => {
        console.log(`[desktop] auto-update: ${info.version} available (current ${app.getVersion()})`)
        latestUpdate = { phase: 'available', newVersion: info.version, currentVersion: app.getVersion() }
        broadcastUpdateState()
      })
      autoUpdater.on('update-downloaded', (info) => {
        console.log(`[desktop] auto-update: ${info.version} downloaded — will install on next quit`)
        // electron-updater stores the downloaded asset path in info.downloadedFile
        // (typed loosely in 6.x; cast at the boundary). On .deb installs this is
        // the path the user needs to `sudo dpkg -i` since Electron can't escalate
        // sudo. On AppImage/dmg/exe, autoUpdater.quitAndInstall() handles it.
        const downloadedFile = (info as { downloadedFile?: string }).downloadedFile ?? null
        latestUpdate = {
          phase: 'downloaded',
          newVersion: info.version,
          currentVersion: app.getVersion(),
          downloadedFile,
          installFormat: detectInstallFormat(),
        }
        broadcastUpdateState()
        if (Notification.isSupported()) {
          new Notification({
            title: `Fleet Runner ${info.version} ready`,
            body: 'Update downloaded — restart Fleet Runner to apply it.',
            silent: true,
            ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
          }).show()
        }
      })
      // Fire-and-forget — failures end up on the 'error' listener above.
      void autoUpdater.checkForUpdatesAndNotify()
      console.log('[desktop] auto-update check kicked off (loki-releases)')
    } catch (e) {
      console.warn('[desktop] auto-update setup failed:', (e as Error).message)
    }
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Ensure the embedded watcher is stopped when the app exits (prevents
// dangling fs.watch handles and pending debounce timers). Same applies
// to the command poller — without aborting it, the long-poll fetch leaves
// the process alive after the windows are closed.
app.on('before-quit', () => {
  if (stopWatcher) {
    try { stopWatcher() } catch { /* ignore */ }
    stopWatcher = null
  }
  if (trayTickHandle) {
    clearInterval(trayTickHandle)
    trayTickHandle = null
  }
  try { stopPoller() } catch { /* ignore */ }
  try { stopPusher() } catch { /* ignore */ }
  try { stopCalendarDrain() } catch { /* ignore */ }
})

function createTray() {
  // Tray icon: the Loki control-window mark, pre-rendered to PNG by
  // desktop/scripts/generate-tray-icon.mjs (kept visually identical to
  // public/icon.svg + BrandMark.tsx; re-run that script if the geometry changes).
  // Falls back to an empty image so the tray still mounts in dev if the file
  // is missing — the menu and click handlers stay functional either way.
  const trayIcon = TRAY_ICON_PATH
    ? nativeImage.createFromPath(TRAY_ICON_PATH)
    : nativeImage.createEmpty()
  tray = new Tray(trayIcon)

  // Surface the window AND navigate to the given path. Used by the tray's
  // quick-link menu items.
  const surfaceAt = (path: string) => {
    if (!mainWindow) return
    mainWindow.show()
    mainWindow.focus()
    const target = new URL(path, WEB_SHELL_URL).toString()
    mainWindow.webContents.loadURL(target).catch((e) => {
      console.warn('[desktop] tray: failed to load', target, e)
    })
  }

  // Quick-link items are deliberately minimal — anything that requires more
  // than one click belongs in the main window's chrome (sidebar, command
  // palette). Tray = "I'm focused elsewhere, just bounce me to the page I
  // need." Order matters: Control (most common entry) first, then create
  // flows, then settings, then quit.
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Fleet Runner', click: () => surfaceAt('/control') },
    { type: 'separator' },
    { label: 'Open Control',       click: () => surfaceAt('/control') },
    { label: 'New project…',       click: () => surfaceAt('/control/new-from-scratch') },
    { label: 'Decisions log',      click: () => surfaceAt('/decisions') },
    { label: 'Sign-in / Settings', click: () => surfaceAt('/settings') },
    { type: 'separator' },
    { label: 'Quit Fleet Runner', click: () => app.quit() }
  ])
  tray.setToolTip(formatTrayTooltip(getPollerStatus()))
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
      }
    }
  })
}

// OS notification fired on each worker.idle event from the embedded watcher.
// Clicking the notification surfaces the main window so the user can act on
// the handoff immediately. Health is encoded in the title so a glance tells
// the user whether a run succeeded.
function notifyOnIdle({ project, handoff }: { project: string; handoff: import('@/lib/events').Handoff }) {
  // v0.6 — push immediately to the cloud so the web UI's SSE feed gets
  // the change within seconds, not after the 5-minute heartbeat. The
  // pushNow() helper coalesces back-to-back calls so a burst of worker.idle
  // events (multiple projects handoffing within the same second) only
  // produces a single round-trip.
  void pushNow().catch(() => { /* non-fatal; next heartbeat picks it up */ })

  // Session 2 of killing-the-bash-daemon: Fleet Runner becomes the autopilot
  // trigger. When the agent self-reports status:ready, ask the cloud what to
  // do next; if it says queue/nextbest/composed, the resulting pending_command
  // flows back through poller.ts (already wired) and lands as a typed prompt
  // in the agent's owned terminal. This replaces the bash Stop hook entirely.
  // Status / cooldown / mode gating all live in dispatch.ts and dispatch-gates
  // .ts — this is just the wire.
  if (handoff.status === 'ready') {
    void dispatchAutopilot({ project, handoff })
      .then((res) => {
        if (res.skipped) {
          console.log(`[autopilot] ${project} skipped: ${res.skipped}`)
        } else {
          console.log(`[autopilot] ${project} dispatched: action=${res.action} reason=${res.reason ?? '(none)'}`)
        }
      })
      .catch((e) => console.warn(`[autopilot] ${project} dispatch error:`, (e as Error).message))
  }

  if (!Notification.isSupported()) return
  const healthBadge = handoff.health === 'good' ? '✓'
    : handoff.health === 'critical' ? '✗'
    : handoff.health === 'needs attention' ? '!'
    : '•'
  const n = new Notification({
    title: `${healthBadge} ${project} — agent idle`,
    body: handoff.done || handoff.next || 'Session handoff written.',
    silent: false,
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
  })
  n.on('click', () => mainWindow?.show())
  n.show()
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
