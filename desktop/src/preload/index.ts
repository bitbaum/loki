import { contextBridge, ipcRenderer } from 'electron'

// `window.fleetRunner` — the IPC bridge from the web shell (Next.js app
// loaded from loki.orangecat.ch) into Fleet Runner's main process.
//
// Every method must justify itself with a real local-only capability:
// something the cloud literally cannot do because it requires reaching
// into the user's machine. The web app uses
// `navigator.userAgent.includes('FleetRunner/')` to detect this object
// is present and degrade gracefully when running in a browser.
//
// v0.7.4 cleanup: dropped ping/getRuntimeStatus/getProjects/dispatchIntent/
// getCurrentState/probeCloud/switchToCloud — those were used only by the
// bundled renderer (now removed). The surviving methods are all consumed
// by the web shell.
contextBridge.exposeInMainWorld('fleetRunner', {
  // Token persistence — FleetRunnerAutoMint reads/writes this so the
  // signed-in browser session can hand a freshly-minted ck_* down to
  // the local poller + pusher without copy-paste.
  saveToken: (token: string) => ipcRenderer.invoke('save-token', token),
  loadToken: () => ipcRenderer.invoke('load-token'),
  clearToken: () => ipcRenderer.invoke('clear-token'),
  getConfigDir: () => ipcRenderer.invoke('get-config-dir'),

  // Command poller status. Renderers either pull a snapshot
  // (`getPollerStatus`) for an immediate read or subscribe via
  // `onPollerStatus` and react to every state transition (the returned
  // function unsubscribes; React effects must call it on cleanup to
  // avoid stacking listeners across re-mounts).
  getPollerStatus: () => ipcRenderer.invoke('get-poller-status'),
  onPollerStatus: (cb: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => cb(status)
    ipcRenderer.on('poller-status', handler)
    return () => ipcRenderer.removeListener('poller-status', handler)
  },

  // Local prerequisite scan — surfaces whether agent CLIs (claude, codex,
  // grok, gemini, cursor) are on PATH. The web app uses this
  // to render an "Install Claude" CTA instead of silently dispatching to
  // a missing binary.
  getInstalledCLIs: (): Promise<{
    agents: Record<string, boolean>;
  }> => ipcRenderer.invoke('get-installed-clis'),

  // Local /dev scan — walks ~/dev, ~/code, ~/Code, ~/Projects (overridable
  // via LOKI_DEV_ROOTS) for git repos. The web app uses this to
  // surface "we see your local repos, register them?" CTAs alongside the
  // GitHub-side suggestions on /control. Returns up to 50 most-recent.
  getLocalDevProjects: (): Promise<{
    projects: Array<{ name: string; path: string; mtimeMs: number; remoteUrl: string | null }>;
  }> => ipcRenderer.invoke('get-local-dev-projects'),

  // Peek tab — the retained output of the agent's owned terminal, without
  // requiring the user to switch their focused terminal. Returns plain
  // text with ANSI escapes stripped, ready to render in <pre>. v0.7.2+ —
  // older builds don't expose this, so callers must typeof-check.
  peekTab: (tab: string): Promise<{ ok: true; content: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke('peek-tab', tab),

  // Reload the web shell from the offline page's retry button. Only
  // available on the offline page; the cloud /control surface doesn't
  // need this because it already has standard browser reload.
  reloadWebShell: (): Promise<boolean> => ipcRenderer.invoke('reload-web-shell'),

  // Auto-update state — used by the UpdateBanner on /control to show
  // "Update available: vX.Y.Z — Restart to install / Run: sudo dpkg -i ..."
  // The renderer reads getUpdateState() once on mount + subscribes via
  // onUpdateState for live changes during the session (the user may stay
  // open for hours; an update could land mid-session).
  //
  // quitAndInstall() applies the downloaded update for self-applying
  // formats (AppImage, dmg, exe). For .deb installs the renderer shows
  // the manual dpkg command instead and this method returns false.
  getUpdateState: (): Promise<unknown> => ipcRenderer.invoke('get-update-state'),
  onUpdateState: (cb: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => cb(state)
    ipcRenderer.on('update-state', handler)
    return () => ipcRenderer.removeListener('update-state', handler)
  },
  quitAndInstall: (): Promise<boolean> => ipcRenderer.invoke('quit-and-install'),

  // Workbench windows — a pane of Loki's own, or the project's site, beside
  // this window or on the other display. The web shell cannot window.open
  // here (every new window is sent to the default browser), so this is the
  // one way a second window exists; the main process places it from the
  // real display list (main/workbench-windows.ts). v0.8.60+.
  openWorkbenchWindow: (
    url: string,
    placement: 'beside' | 'other-screen'
  ): Promise<{ ok: true; displays: number } | { ok: false; error: string }> =>
    ipcRenderer.invoke('open-workbench-window', url, placement),
})
