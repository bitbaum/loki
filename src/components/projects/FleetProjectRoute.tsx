"use client";
import { useEffect } from "react";
import { registerFleetRouteProject } from "@/lib/fleet-context";

/** The authorized server page resolves identity; the shell never guesses it from a previous tab. */
export function FleetProjectRoute({ pathname, project }: { pathname: string; project: string }) {
  useEffect(() => registerFleetRouteProject(pathname, project), [pathname, project]);
  return null;
}
