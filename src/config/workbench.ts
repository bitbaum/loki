import { Eye, SquareTerminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fleetSurfaceHref } from "@/lib/fleet-context";

/**
 * The workbench: one project's builder and what it is doing, side by side,
 * with the site in a window of its own — on the same screen or the other.
 *
 * Two panes and ONE box. Session is where you say what to change — the
 * agent's own box, which types into a live session or starts one — and
 * Watch is what happens next, step by step, with the agent's screen and
 * where the change is. Loki's chat is not a column: beside the session box
 * it was a second place to type on one screen, and the session already
 * offers Loki about itself ("What's going on?"). /loki stays its own page.
 *
 * SSOT for what a pane is. The layout (which panes this window shows) is
 * derived from this list (lib/workbench/layout.ts); the strip, the pop-out
 * links and the narrow shape all read it. A new pane is one entry here.
 *
 * The SITE is deliberately not a pane. Every fleet site answers with
 * `frame-ancestors 'none'` and `Cross-Origin-Opener-Policy: same-origin`
 * (scripts/site-template/lib/security.ts), so it can be neither framed nor
 * reached through `window.opener`: the only honest shape is its own window,
 * which is also the shape a second screen wants. docs/architecture/workbench.md.
 */
export type WorkbenchPaneId = "session" | "watch";

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
    label: "Session",
    description: "Say what to change; the agent at work",
    icon: SquareTerminal,
    pageHref: (p) => fleetSurfaceHref("terminal", p.workspaceKey),
  },
  watch: {
    id: "watch",
    label: "Watch",
    description: "What is happening, and where the change is",
    icon: Eye,
    pageHref: (p) => `/projects/${encodeURIComponent(p.id)}/watch`,
  },
};

/** Every pane, in the order the columns are drawn. */
export const WORKBENCH_PANE_IDS: readonly WorkbenchPaneId[] = ["session", "watch"];

/** Two columns need room: from here the open panes sit side by side; below
 *  it the window shows one pane at a time and the strip's buttons choose
 *  which. Tailwind's `xl`, so a window tiled beside the site on a laptop
 *  (720px) is one pane, never two strips. */
export const WORKBENCH_COLUMNS_QUERY = "(min-width: 80rem)";

/** `?pane=` — a window that shows ONE pane (popped out, or on the other screen). */
export const WORKBENCH_PANE_PARAM = "pane";

/** Where a window goes when it is opened from the workbench. */
export type WorkbenchPlacement = "beside" | "other-screen";

export const WORKBENCH_PLACEMENTS: Record<WorkbenchPlacement, { label: string }> = {
  beside: { label: "Beside this window" },
  "other-screen": { label: "On the other screen" },
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
