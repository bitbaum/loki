export const FLEET_PROJECT_STORAGE_KEY = "loki:active-project";
export const FLEET_PROJECT_EVENT = "loki:project-context";

export type FleetWorkspaceSurfaceId = "profile" | "chat" | "control" | "terminal";
export type FleetSurfaceId = FleetWorkspaceSurfaceId | "activity";

/** Which terminal source a watch link should open. Callers that know where the
 *  agent runs should say so; omitting it leaves the terminal to resolve it. */
export type FleetTerminalSource = "cloud" | "machine" | "shell";

export function fleetSurfaceHref(
  surface: FleetSurfaceId,
  project: string | null,
  /** Only meaningful for the terminal surface. */
  source?: FleetTerminalSource,
  /** Orchestration run Watch and Terminal share — Terminal opens the Loki rail on it. */
  runId?: string | null,
): string {
  const value = project?.trim();
  if (!value) {
    if (surface === "profile") return "/projects";
    if (surface === "chat") return "/loki";
    if (surface === "control") return "/control";
    if (surface === "activity") return "/activity";
    return "/terminal";
  }

  const encoded = encodeURIComponent(value);
  if (surface === "profile") return `/projects?project=${encoded}`;
  if (surface === "chat") return `/loki?project=${encoded}`;
  if (surface === "control") return `/control?focus=${encoded}`;
  if (surface === "activity") return `/activity?project=${encoded}`;
  const run = runId?.trim() ? `&run=${encodeURIComponent(runId.trim())}` : "";
  return source
    ? `/terminal?project=${encoded}&source=${source}${run}`
    : `/terminal?project=${encoded}${run}`;
}

/** Where to watch a queued inject: Control for state, Activity for the ledger,
 *  Terminal only once a session is actually running. */
export function injectWatchUrls(
  projectKey: string,
  source?: FleetTerminalSource,
): {
  watchUrl: string;
  activityUrl: string;
  terminalUrl: string;
} {
  return {
    watchUrl: fleetSurfaceHref("control", projectKey),
    activityUrl: fleetSurfaceHref("activity", projectKey),
    terminalUrl: fleetSurfaceHref("terminal", projectKey, source),
  };
}

export function projectFromFleetRoute(pathname: string, search: URLSearchParams): string | null {
  const value =
    pathname === "/projects"
      ? search.get("project")
      : pathname.startsWith("/loki")
        ? search.get("project")
        : pathname.startsWith("/control")
          ? search.get("focus")
          : pathname.startsWith("/terminal")
            ? (search.get("project") ?? search.get("tab"))
            : pathname.startsWith("/activity")
              ? search.get("project")
              : null;
  return value?.trim() || null;
}

export function readRememberedFleetProject(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(FLEET_PROJECT_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function rememberFleetProject(project: string | null): void {
  if (typeof window === "undefined") return;
  const value = project?.trim() || null;
  try {
    if (value) window.localStorage.setItem(FLEET_PROJECT_STORAGE_KEY, value);
    else window.localStorage.removeItem(FLEET_PROJECT_STORAGE_KEY);
  } catch {
    // The tabs still work for the current route when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(FLEET_PROJECT_EVENT, { detail: { project: value } }));
}
