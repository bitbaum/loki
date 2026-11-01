import { SquareTerminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fleetSurfaceHref } from "@/lib/fleet-context";

/**
 * The workbench: one project on one screen — the site as Loki's browser
 * sees it, the robot at work, one line of state and ONE box — with the
 * real site in a window of its own beside it or on the other screen.
 *
 * One thing to do, a few things to see. The box is the session's own (it
 * types into the live agent or starts one); everything that is not the
 * site, the robot or the box sits behind one "⋯". Loki's chat is not here:
 * beside the session's box it was a second place to type on one screen,
 * and the session already offers Loki about itself ("What's going on?").
 *
 * SSOT for the panes of Loki's own that a window can show on their own
 * (`?pane=`). The site is a REGION, not a pane: it is a picture of Loki's
 * browser (the review worker's frames), and "in its own window" for the
 * site means the real site, which every fleet site forbids framing and
 * severs as an opener (docs/architecture/workbench.md).
 */
export type WorkbenchPaneId = "session";

export type WorkbenchPane = {
  id: WorkbenchPaneId;
  label: string;
  /** What the pane is for, in one line (the narrow shape's secondary line). */
  description: string;
  icon: LucideIcon;
  /** The page this pane is a column of — where a phone opens it instead. */
  pageHref: (project: { id: string; workspaceKey: string }) => string;
};

export const WORKBENCH_PANES: Record<WorkbenchPaneId, WorkbenchPane> = {
  session: {
    id: "session",
    label: "The robot",
    description: "Say what to change; the agent at work",
    icon: SquareTerminal,
    pageHref: (p) => fleetSurfaceHref("terminal", p.workspaceKey),
  },
};

/** Every pane, in the order the columns are drawn. */
export const WORKBENCH_PANE_IDS: readonly WorkbenchPaneId[] = ["session"];

/** The site region needs room beside the robot: from here both are on
 *  screen; below it the robot alone, the site being in its own window
 *  anyway. Tailwind's `xl`, so a window tiled beside the site on a laptop
 *  (720px) is the robot and the box, never two strips. */
export const WORKBENCH_COLUMNS_QUERY = "(min-width: 80rem)";

/** `?pane=` — a window that shows ONE pane (popped out, or on the other screen). */
export const WORKBENCH_PANE_PARAM = "pane";

/** Where a window goes when it is opened from the workbench. */
export type WorkbenchPlacement = "beside" | "other-screen";

export const WORKBENCH_PLACEMENTS: Record<WorkbenchPlacement, { label: string }> = {
  beside: { label: "in its own window" },
  "other-screen": { label: "on the other screen" },
};

export function workbenchHref(projectId: string, pane?: WorkbenchPaneId): string {
  const base = `/projects/${encodeURIComponent(projectId)}/workbench`;
  return pane ? `${base}?${WORKBENCH_PANE_PARAM}=${pane}` : base;
}

/** One window per project and pane: opening it again brings it forward. */
export function workbenchWindowName(projectId: string, what: WorkbenchPaneId | "site"): string {
  return `loki-workbench-${projectId}-${what}`;
}

/** The session's Loki rail is remembered for the workbench apart from the
 *  Sessions page: a half-width column and a full page are different places
 *  to want one. */
export const WORKBENCH_SESSION_RAIL_KEY = "loki:workbench:terminal-rail";

/** How often the site region and the state line ask the server while
 *  something is moving. */
export const WORKBENCH_POLL_MS = 5000;
