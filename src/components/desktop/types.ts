/**
 * Shared types for the Fleet Runner IPC bridge.
 *
 * The desktop preload (`desktop/src/preload/index.ts`) exposes
 * `window.fleetRunner`; both `FleetRunnerAutoMint` and `FleetRunnerStatusPill`
 * read from it. Centralizing the declaration here avoids the conflicting
 * `Window` augmentations the two components would otherwise produce.
 *
 * Every property is optional — older shipped builds of the desktop app may
 * be missing newer methods. Callers must defensively check before invoking.
 */
export type PollerState = "idle" | "connecting" | "connected" | "error";

export type PollerStatus = {
  state: PollerState;
  baseUrl: string;
  lastPollAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  tokenPrefix: string | null;
  commandsHandled: number;
  commandsRejected: number;
};

/** Result of the v0.6.0 `getInstalledCLIs` IPC scan. */
export type InstalledCLIs = {
  agents: Record<string, boolean>;
};

/** Single entry returned by the v0.6.0 `getLocalDevProjects` IPC walker. */
export type LocalDevProject = {
  name: string;
  path: string;
  mtimeMs: number;
  remoteUrl: string | null;
};

export type FleetRunnerBridge = {
  saveToken: (token: string) => Promise<{ ok: boolean; error?: string }>;
  loadToken: () => Promise<string | null>;
  clearToken: () => Promise<{ ok: boolean; error?: string }>;
  getConfigDir: () => Promise<string>;
  getPollerStatus: () => Promise<PollerStatus>;
  onPollerStatus: (cb: (status: PollerStatus) => void) => () => void;
  /** Local prerequisite scan — true if the named binary is on the user's PATH.
   *  Added in Fleet Runner v0.6.0; older builds won't expose this method. */
  getInstalledCLIs: () => Promise<InstalledCLIs>;
  /** Cursor-style "recent local projects" — walks the user's dev folder
   *  roots (default ~/dev, ~/code, ~/Code, ~/Projects) for git repos and
   *  returns them sorted by recency. Used by the web app to surface
   *  an "Import these N local repos" CTA on /control. v0.6.0+. */
  getLocalDevProjects: () => Promise<{ projects: LocalDevProject[] }>;
  /** Capture a snapshot of an agent terminal's owned PTY buffer right now. Returns
   *  the screen content as plain text (ANSI stripped). v0.7.2+. */
  peekTab: (tab: string) => Promise<{ ok: true; content: string } | { ok: false; error: string }>;
  /** Reload the cloud web shell. Only the offline page uses this. v0.7.4+. */
  reloadWebShell: () => Promise<boolean>;
  /** Auto-update state — null until electron-updater detects something.
   *  Used by the UpdateBanner on /control to surface a "newer version
   *  available" banner with the exact upgrade path. v0.7.5+. */
  getUpdateState: () => Promise<UpdateState | null>;
  onUpdateState: (cb: (state: UpdateState | null) => void) => () => void;
  /** Apply downloaded update (AppImage/dmg/exe only). Returns false on
   *  .deb where Electron can't escalate sudo — renderer shows manual
   *  dpkg -i command instead. v0.7.5+. */
  quitAndInstall: () => Promise<boolean>;
  /** Open a window — a workbench pane of Loki's own, or the project's site —
   *  beside this one or on the other display. The web shell cannot
   *  `window.open` inside Fleet Runner (every new window goes to the default
   *  browser), so this is the only way a second window exists there. The
   *  main process places it from the real display list and brings an open
   *  one forward instead of opening it twice. v0.8.60+. */
  openWorkbenchWindow: (
    url: string,
    placement: "beside" | "other-screen",
  ) => Promise<{ ok: true; displays: number } | { ok: false; error?: string }>;
};

/** Result of the v0.7.5 update-state IPC. */
export type UpdateState = {
  phase?: "available" | "downloaded";
  newVersion?: string;
  currentVersion?: string;
  downloadedFile?: string | null;
  installFormat?: "deb" | "rpm" | "appimage" | "dmg" | "exe" | "unknown";
  error?: string;
};

declare global {
  interface Window {
    fleetRunner?: Partial<FleetRunnerBridge>;
  }
}

export {};
