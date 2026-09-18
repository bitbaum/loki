"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  FLEET_PROJECT_EVENT,
  projectFromFleetRoute,
  readRememberedFleetProject,
  rememberFleetProject,
} from "@/lib/fleet-context";

function subscribe(onStoreChange: () => void) {
  window.addEventListener(FLEET_PROJECT_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(FLEET_PROJECT_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/**
 * The project the operator is currently looking at — route first, then the
 * remembered one.
 *
 * Extracted from FleetSurfaceGuide rather than copied, because the second
 * reader is the reason this exists: the Terminal's empty state had its own
 * idea of the active project (the attached tab), which is null precisely when
 * the empty state renders. So the page's tab strip linked to
 * `/control?focus=loki` while the button 200px below it linked to `/control`,
 * and the launcher underneath offered to start an agent in whichever project
 * happened to sort first. One reader, one answer.
 *
 * The server snapshot is `null` on purpose: localStorage does not exist during
 * SSR, and returning a guess there would hydrate one project and then swap to
 * another. Callers must render sensibly with no project.
 */
export function useFleetProject(): string | null {
  const pathname = usePathname();

  const read = useCallback(() => {
    const routeProject = projectFromFleetRoute(
      pathname,
      new URLSearchParams(window.location.search),
    );
    return routeProject ?? readRememberedFleetProject();
  }, [pathname]);

  useEffect(() => {
    const routeProject = projectFromFleetRoute(
      pathname,
      new URLSearchParams(window.location.search),
    );
    if (routeProject) rememberFleetProject(routeProject);
  }, [pathname]);

  return useSyncExternalStore(subscribe, read, () => null);
}
